# mcp-docs — Claude Code project instructions

## Project overview

MCP server that exposes platform documentation (markdown files) via full-text and optional vector search, built with TypeScript and Orama.

## Stack

- **Runtime**: Node.js 18+, ES modules (`"type": "module"`)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Search**: `@orama/orama` (in-memory, full-text BM25 + optional vector)
- **Embeddings**: OpenAI API (`text-embedding-3-small`) — only when `VECTOR_SEARCH=true`
- **Language**: TypeScript 5, compiled to `dist/`


## Build & run

```bash
npm run build          # tsc → dist/
npm start              # full-text search, uses ./docs by default

# With vector search:
OPENAI_API_KEY=sk-... VECTOR_SEARCH=true npm start
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCS_DIR` | `./docs` | Path to markdown docs |
| `VECTOR_SEARCH` | `false` | Enable OpenAI vector search |
| `OPENAI_API_KEY` | — | Required when `VECTOR_SEARCH=true` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model |

## Conventions

- All `console.error` logs are prefixed with `[indexer]`, `[server]`, `[config]`, or `[fatal]` — they go to stderr so they don't pollute the MCP stdio transport
- Each markdown file in `docs/` is a single chunk; no splitting needed
- The Orama index is rebuilt in memory on every startup
- Adding a new doc = drop a `.md` file in `docs/` and restart the server
