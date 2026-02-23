import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { create, insert, search, count, type AnyOrama } from "@orama/orama";
import OpenAI from "openai";
import type { DocRecord, SearchResult, IndexerConfig } from "./types.js";

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

/** Extract the first H1 heading from markdown content, or fall back to filename */
function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  // Fallback: use filename without extension
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1].replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

async function generateEmbeddings(
  texts: string[],
  openai: OpenAI,
  model: string
): Promise<number[][]> {
  // OpenAI supports batching up to 2048 inputs per request
  const response = await openai.embeddings.create({
    model,
    input: texts,
  });

  // Results are returned in the same order as inputs
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

    // Read all files
    const docs: DocRecord[] = await Promise.all(
      files.map(async (filePath) => {
        const content = await readFile(filePath, "utf-8");
        const path = relative(this.config.docsDir, filePath).replace(/\\/g, "/");
        return {
          id: path,
          path,
          title: extractTitle(content, path),
          content,
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

    // Insert all documents and populate the store
    for (const doc of docs) {
      await insert(db, doc as unknown as Record<string, unknown>);
      this.docStore.set(doc.path, doc);
    }

    this.db = db;

    const total = await count(db);
    console.error(`[indexer] Index ready — ${total} document(s) indexed`);
  }

  /** Search the index. Uses hybrid search when vector search is enabled. */
  async search(
    query: string,
    topK = 5
  ): Promise<SearchResult[]> {
    if (!this.db) throw new Error("Index not built yet. Call build() first.");

    let hits: Array<{ document: Record<string, unknown>; score: number }> = [];

    if (this.config.vectorSearch && this.openai) {
      // Embed the query, then run vector search
      const [queryEmbedding] = await generateEmbeddings(
        [query],
        this.openai,
        this.config.embeddingModel
      );

      const results = await search(this.db, {
        mode: "hybrid",
        term: query,
        vector: {
          value: queryEmbedding,
          property: "embedding",
        },
        limit: topK,
      });

      hits = results.hits as typeof hits;
    } else {
      // Full-text search only
      const results = await search(this.db, {
        mode: "fulltext",
        term: query,
        properties: ["title", "content"],
        limit: topK,
      });

      hits = results.hits as typeof hits;
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

  /** List all indexed document paths */
  listDocs(): Array<{ path: string; title: string }> {
    return Array.from(this.docStore.values()).map(({ path, title }) => ({
      path,
      title,
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
      // Re-use the pre-computed embedding — no extra API call needed
      const results = await search(this.db, {
        mode: "hybrid",
        term: doc.title,
        vector: {
          value: doc.embedding,
          property: "embedding",
        },
        limit: topK + 1, // +1 so we can drop the doc itself
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
