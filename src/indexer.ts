import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import { create, insert, search, count, type AnyOrama } from "@orama/orama";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import { parse as parseYaml } from "yaml";
import OpenAI from "openai";
import type { DocRecord, SearchResult, IndexerConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

interface Frontmatter {
  title?: string;
  description?: string;
  tags?: string[];
}

type YamlNode = { type: "yaml"; value: string; position: { end: { offset: number } } };

const mdProcessor = unified().use(remarkParse).use(remarkFrontmatter);

/** Parses a raw markdown file into structured metadata and a clean body. */
function parseDoc(raw: string, filePath: string): { data: Frontmatter; title: string; body: string } {
  const tree = mdProcessor.parse(raw);

  const yamlNode = tree.children.find((n) => n.type === "yaml") as YamlNode | undefined;
  const data: Frontmatter = yamlNode ? (parseYaml(yamlNode.value) as Frontmatter ?? {}) : {};
  const body = yamlNode ? raw.slice(yamlNode.position.end.offset) : raw;
  const title = data.title ?? basename(filePath, ".md");

  return { data, title, body };
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Schema used when vector search is disabled (full-text only) */
function makeTextSchema() {
  return create({
    schema: {
      id: "string",
      path: "string",
      title: "string",
      content: "string",
      tags: "enum[]",
    } as const,
  });
}

/** Schema used when vector search is enabled (hybrid: full-text + vector) */
function makeVectorSchema(dimensions: number) {
  return create({
    schema: {
      id: "string",
      path: "string",
      title: "string",
      content: "string",
      tags: "enum[]",
      embedding: `vector[${dimensions}]` as `vector[${number}]`,
    } as const,
  });
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/** Walk a directory and return all .md file paths recursively */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(fullPath);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

async function generateEmbeddings(
  texts: string[],
  openai: OpenAI,
  model: string
): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model,
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

export class DocsIndexer {
  private db: AnyOrama | null = null;
  private readonly config: IndexerConfig;
  private openai: OpenAI | null = null;
  /** Full content store for get_doc lookups */
  private docStore = new Map<string, DocRecord>();

  constructor(config: IndexerConfig) {
    this.config = config;

    if (config.vectorSearch) {
      this.openai = new OpenAI();
    }
  }

  /** Load all markdown files and build the Orama index */
  async build(): Promise<void> {
    const files = await findMarkdownFiles(this.config.docsDir);

    if (files.length === 0) {
      throw new Error(`No markdown files found in: ${this.config.docsDir}`);
    }

    console.error(`[indexer] Found ${files.length} markdown file(s)`);

    // Read all files and parse frontmatter + title via remark
    const docs: DocRecord[] = await Promise.all(
      files.map(async (filePath) => {
        const raw = await readFile(filePath, "utf-8");
        const path = relative(this.config.docsDir, filePath).replace(/\\/g, "/");
        const { data, title, body: _body } = parseDoc(raw, path);

        return {
          id: path,
          path,
          content: raw,
          title,
          description: data.description ?? "",
          tags: data.tags ?? [],
        };
      })
    );

    // Generate embeddings if vector search is enabled
    if (this.config.vectorSearch && this.openai) {
      console.error("[indexer] Generating embeddings...");

      const embeddings = await generateEmbeddings(
        docs.map((d) => d.title + "\n\n" + d.content),
        this.openai,
        this.config.embeddingModel
      );

      for (let i = 0; i < docs.length; i++) {
        docs[i].embedding = embeddings[i];
      }

      console.error("[indexer] Embeddings generated");
    }

    // Create the Orama database
    const db = this.config.vectorSearch
      ? await makeVectorSchema(this.config.embeddingDimensions)
      : await makeTextSchema();

    // Insert all documents — use body (without frontmatter) for the content field
    // so frontmatter YAML doesn't pollute full-text search
    for (const doc of docs) {
      const { body } = parseDoc(doc.content, doc.path);
      await insert(db, {
        id: doc.id,
        path: doc.path,
        title: doc.title,
        content: body,
        tags: doc.tags,
        ...(doc.embedding ? { embedding: doc.embedding } : {}),
      } as unknown as Record<string, unknown>);

      this.docStore.set(doc.path, doc);
    }

    this.db = db;

    const total = await count(db);
    console.error(`[indexer] Index ready — ${total} document(s) indexed`);
  }

  /**
   * Search the index.
   * When filterTags is provided, one Orama query is issued per tag using the
   * native `where: { tags: { containsAll: [tag] } }` filter (OR semantics:
   * results from all per-tag searches are merged and re-ranked by score).
   * No post-filtering — Orama only scans the matching subset for each query.
   */
  async search(
    query: string,
    topK = 5,
    filterTags?: string[]
  ): Promise<SearchResult[]> {
    if (!this.db) throw new Error("Index not built yet. Call build() first.");

    const tags = filterTags && filterTags.length > 0 ? filterTags : null;

    // Build the base search params (without where), then extend per tag.
    // Using unknown cast because AnyOrama loosens the generic typed overloads.
    type Hit = { document: Record<string, unknown>; score: number };

    const runSearch = async (where?: Record<string, unknown>): Promise<Hit[]> => {
      if (this.config.vectorSearch && this.openai) {
        const [queryEmbedding] = await generateEmbeddings(
          [query],
          this.openai,
          this.config.embeddingModel
        );
        const results = await search(this.db!, {
          mode: "hybrid",
          term: query,
          vector: { value: queryEmbedding, property: "embedding" },
          limit: topK,
          ...(where ? { where } : {}),
        } as unknown as Parameters<typeof search>[1]);
        return results.hits as Hit[];
      } else {
        const results = await search(this.db!, {
          mode: "fulltext",
          term: query,
          properties: ["title", "content"],
          limit: topK,
          ...(where ? { where } : {}),
        } as unknown as Parameters<typeof search>[1]);
        return results.hits as Hit[];
      }
    };

    let hits: Hit[];

    if (!tags) {
      // No tag filter — single search across all docs
      hits = await runSearch();
    } else {
      // One search per tag (OR semantics). Merge by path, keep highest score.
      const byPath = new Map<string, Hit>();
      await Promise.all(
        tags.map(async (tag) => {
          const tagHits = await runSearch({ tags: { containsAll: [tag] } });
          for (const hit of tagHits) {
            const path = hit.document["path"] as string;
            const existing = byPath.get(path);
            if (!existing || hit.score > existing.score) {
              byPath.set(path, hit);
            }
          }
        })
      );
      // Re-sort merged results by score descending, take topK
      hits = Array.from(byPath.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    return hits.map(({ document, score }) => ({
      path: document["path"] as string,
      title: document["title"] as string,
      excerpt: (document["content"] as string).slice(0, 500).trimEnd(),
      score,
    }));
  }

  /** Retrieve the full content of a document by its relative path */
  getDoc(path: string): DocRecord | undefined {
    return this.docStore.get(path);
  }

  /** List all indexed document paths with their titles and tags */
  listDocs(): Array<{ path: string; title: string; tags: string[] }> {
    return Array.from(this.docStore.values()).map(({ path, title, tags }) => ({
      path,
      title,
      tags,
    }));
  }

  /**
   * Find documents related to the given path.
   * Uses the stored embedding (vector mode) or the doc's title (text mode).
   * The source document is excluded from results.
   */
  async findRelated(path: string, topK = 3): Promise<SearchResult[]> {
    if (!this.db) throw new Error("Index not built yet. Call build() first.");

    const doc = this.docStore.get(path);
    if (!doc) return [];

    let hits: Array<{ document: Record<string, unknown>; score: number }> = [];

    if (this.config.vectorSearch && this.openai && doc.embedding) {
      const results = await search(this.db, {
        mode: "hybrid",
        term: doc.title,
        vector: {
          value: doc.embedding,
          property: "embedding",
        },
        limit: topK + 1,
      });
      hits = results.hits as typeof hits;
    } else {
      const results = await search(this.db, {
        mode: "fulltext",
        term: doc.title,
        properties: ["title", "content"],
        limit: topK + 1,
      });
      hits = results.hits as typeof hits;
    }

    return hits
      .filter(({ document }) => (document["path"] as string) !== path)
      .slice(0, topK)
      .map(({ document, score }) => ({
        path: document["path"] as string,
        title: document["title"] as string,
        excerpt: (document["content"] as string).slice(0, 300).trimEnd(),
        score,
      }));
  }
}
