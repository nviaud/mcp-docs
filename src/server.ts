import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DocsIndexer } from "./indexer.js";

export async function startServer(indexer: DocsIndexer): Promise<void> {
  const server = new McpServer({
    name: "mcp-docs",
    version: "1.0.0",
  });

  // ------------------------------------------------------------------
  // Tool: search_docs
  // Returns the top-K most relevant pages (title + excerpt + score).
  // Use get_doc to fetch the full content of a specific result.
  // ------------------------------------------------------------------
  server.registerTool(
    "search_docs",
    {
      description:
        "Search the platform documentation. Returns the most relevant pages for a given query. " +
        "Use get_doc to retrieve the full content of a result.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("The question or keywords to search for in the documentation"),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Number of results to return (default: 5)"),
      },
    },
    async ({ query, top_k }) => {
      const results = await indexer.search(query, top_k ?? 5);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No documentation found for this query." }],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `## ${i + 1}. ${r.title}\n` +
            `**File:** \`${r.path}\`  |  **Score:** ${r.score.toFixed(4)}\n\n` +
            `${r.excerpt}${r.excerpt.length === 500 ? "…" : ""}`
        )
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: formatted }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: get_doc
  // Returns the full markdown content of a documentation page.
  // ------------------------------------------------------------------
  server.registerTool(
    "get_doc",
    {
      description:
        "Retrieve the full markdown content of a documentation page by its file path. " +
        "Use list_docs or search_docs to discover available paths.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            'Relative path of the doc file, e.g. "guides/quickstart.md"'
          ),
      },
    },
    async ({ path }) => {
      const doc = indexer.getDoc(path);

      if (!doc) {
        return {
          content: [{ type: "text", text: `Document not found: ${path}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: doc.content }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: list_docs
  // Returns all indexed document paths and titles.
  // ------------------------------------------------------------------
  server.registerTool(
    "list_docs",
    {
      description: "List all available documentation pages (path and title).",
      inputSchema: {},
    },
    async () => {
      const docs = indexer.listDocs();

      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: "No documents indexed." }],
        };
      }

      const list = docs
        .map((d) => `- \`${d.path}\` — ${d.title}`)
        .join("\n");

      return {
        content: [{ type: "text", text: `# Documentation Index\n\n${list}` }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[server] MCP server connected and ready");
}
