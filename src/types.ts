export interface DocRecord {
  id: string;
  /** Relative path from the docs root, e.g. "guides/quickstart.md" */
  path: string;
  /** Full markdown content */
  content: string;
  /** Optional: title extracted from first H1 heading */
  title: string;
  /** Pre-computed embedding vector (only present when vector search is enabled) */
  embedding?: number[];
}

export interface SearchResult {
  path: string;
  title: string;
  /** Excerpt of the content (first N chars) */
  excerpt: string;
  score: number;
}

export interface IndexerConfig {
  /** Absolute path to the docs directory */
  docsDir: string;
  /** When true, embeddings are generated and vector search is enabled */
  vectorSearch: boolean;
  /** OpenAI model used for embeddings (ignored when vectorSearch is false) */
  embeddingModel: string;
  /** Number of dimensions for the embedding model */
  embeddingDimensions: number;
}
