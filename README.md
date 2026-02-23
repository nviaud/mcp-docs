# mcp-docs

MCP server that exposes your markdown documentation via full-text and optional vector (semantic) search, powered by [Orama](https://orama.com).

## Architecture

```
docs/*.md  →  DocsIndexer (Orama)  →  MCP Server (stdio)
                    ↑
          OpenAI Embeddings API
          (only when VECTOR_SEARCH=true)
```

- **No local LLM** — embeddings are generated via OpenAI's API at startup and cached in memory.
- **Full-text search** works out of the box with no API key needed.
- **1 file = 1 chunk** — each markdown file is indexed as a single document.

## Tools exposed

| Tool | Description |
|------|-------------|
| `search_docs` | Search docs by query, returns top-K results with excerpts |
| `get_doc` | Retrieve the full content of a doc by path |
| `list_docs` | List all indexed documents |

## Setup

```bash
npm install
npm run build
```

## Running

### Full-text search only (no API key needed)

```bash
DOCS_DIR=./docs node dist/index.js
```

### With vector (semantic) search

```bash
OPENAI_API_KEY=sk-...  VECTOR_SEARCH=true  DOCS_DIR=./docs  node dist/index.js
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCS_DIR` | `./docs` | Path to your markdown documentation |
| `VECTOR_SEARCH` | `false` | Enable semantic (vector) search |
| `OPENAI_API_KEY` | — | Required when `VECTOR_SEARCH=true` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model (`text-embedding-3-small` or `text-embedding-3-large`) |

## Claude configuration

### Local project config (`.mcp.json`)

Place a `.mcp.json` file at the root of **any project** where you want this server available. Claude Code picks it up automatically.

```json
{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DOCS_DIR": "./docs",
        "VECTOR_SEARCH": "true",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

> The paths in `args` and `env` are relative to the directory containing `.mcp.json`.

### Claude Desktop (global config)

To make the server available in all Claude Desktop conversations, add it to:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-docs/dist/index.js"],
      "env": {
        "DOCS_DIR": "/absolute/path/to/your/docs",
        "VECTOR_SEARCH": "true",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```
