export interface DocRecord {
  id: string;
  /** Relative path from the docs root, e.g. "guides/quickstart.md" */
  path: string;
  /** Full markdown content (including frontmatter) */
  content: string;
  /** Title: from frontmatter, then first H1, then filename */
  title: string;
  /** Short description from frontmatter */
  description: string;
  /** Tags from frontmatter, used to scope guide searches */
  tags: string[];
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

export interface GuideDefinition {
  /** Unique identifier, matches the filename (without .json) */
  id: string;
  /** Human-readable name shown in list_guides */
  title: string;
  /** Short summary shown in list_guides */
  description: string;
  /** Instructions injected at the top of every get_guide response */
  instructions: string;
  /**
   * Tags used to scope the doc search.
   * Only docs whose frontmatter tags overlap with this list are returned.
   * Leave empty to search across all docs.
   */
  tags: string[];
}
