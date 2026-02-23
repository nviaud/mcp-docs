import { resolve } from "node:path";
import { DocsIndexer } from "./indexer.js";
import { GuidesLoader } from "./guides.js";
import { startServer } from "./server.js";

// ---------------------------------------------------------------------------
// Configuration via environment variables
// ---------------------------------------------------------------------------

/** Absolute path to your docs directory */
const DOCS_DIR = process.env.DOCS_DIR
  ? resolve(process.env.DOCS_DIR)
  : resolve("./docs");

/** Absolute path to your guides directory */
const GUIDES_DIR = process.env.GUIDES_DIR
  ? resolve(process.env.GUIDES_DIR)
  : resolve("./guides");

/**
 * Set VECTOR_SEARCH=true to enable vector (semantic) search.
 * Requires OPENAI_API_KEY to be set.
 */
const VECTOR_SEARCH = process.env.VECTOR_SEARCH === "true";

/**
 * OpenAI embedding model.
 * - "text-embedding-3-small"  → 1536 dims, cheap, fast  (default)
 * - "text-embedding-3-large"  → 3072 dims, more accurate
 */
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

const EMBEDDING_DIMENSIONS = EMBEDDING_MODEL === "text-embedding-3-large"
  ? 3072
  : 1536;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  if (VECTOR_SEARCH && !process.env.OPENAI_API_KEY) {
    console.error(
      "[error] VECTOR_SEARCH=true but OPENAI_API_KEY is not set. " +
        "Either set the key or disable vector search."
    );
    process.exit(1);
  }

  console.error(`[config] docs dir    : ${DOCS_DIR}`);
  console.error(`[config] guides dir  : ${GUIDES_DIR}`);
  console.error(`[config] vector search: ${VECTOR_SEARCH}`);
  if (VECTOR_SEARCH) {
    console.error(`[config] embedding model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)`);
  }

  const indexer = new DocsIndexer({
    docsDir: DOCS_DIR,
    vectorSearch: VECTOR_SEARCH,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  });

  const guidesLoader = new GuidesLoader(GUIDES_DIR);

  await indexer.build();
  await guidesLoader.load();
  await startServer(indexer, guidesLoader);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
