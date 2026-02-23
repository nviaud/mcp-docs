import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DocsIndexer } from "./indexer.js";
import type { GuidesLoader } from "./guides.js";

export async function startServer(
  indexer: DocsIndexer,
  guidesLoader: GuidesLoader
): Promise<void> {
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
        related_top_k: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(3)
          .describe("Number of related documents to include (default: 3, set to 0 to disable)"),
      },
    },
    async ({ path, related_top_k }) => {
      const doc = indexer.getDoc(path);

      if (!doc) {
        return {
          content: [{ type: "text", text: `Document not found: ${path}` }],
          isError: true,
        };
      }

      const topK = related_top_k ?? 3;
      let text = doc.content;

      if (topK > 0) {
        const related = await indexer.findRelated(path, topK);

        if (related.length > 0) {
          const relatedSection = related
            .map(
              (r) =>
                `- \`${r.path}\` — **${r.title}**\n  ${r.excerpt}${r.excerpt.length === 300 ? "…" : ""}`
            )
            .join("\n\n");

          text += `\n\n---\n\n## Related documents\n\n${relatedSection}`;
        }
      }

      return {
        content: [{ type: "text", text }],
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
        .map((d) => {
          const tagStr = d.tags.length > 0 ? `  \`[${d.tags.join(", ")}]\`` : "";
          return `- \`${d.path}\` — ${d.title}${tagStr}`;
        })
        .join("\n");

      return {
        content: [{ type: "text", text: `# Documentation Index\n\n${list}` }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: list_guides
  // Returns all available guides (id, title, description).
  // ------------------------------------------------------------------
  server.registerTool(
    "list_guides",
    {
      description:
        "List all available guides. A guide bundles several documentation pages together with AI instructions for a specific developer task (e.g. building a Docker image). Use get_guide to retrieve the full content of a guide.",
      inputSchema: {},
    },
    async () => {
      const guides = guidesLoader.list();

      if (guides.length === 0) {
        return {
          content: [{ type: "text", text: "No guides available." }],
        };
      }

      const list = guides
        .map((g) => {
          const tagStr = g.tags.length > 0 ? ` \`[${g.tags.join(", ")}]\`` : "";
          return `- **${g.id}** — ${g.title}${tagStr}\n  ${g.description}`;
        })
        .join("\n\n");

      return {
        content: [{ type: "text", text: `# Available Guides\n\n${list}` }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: get_guide
  // Searches docs scoped to the guide's tags, prepends its instructions.
  // ------------------------------------------------------------------
  server.registerTool(
    "get_guide",
    {
      description:
        "Retrieve a guide by its id. Returns AI instructions and the full content of all documentation pages bundled in that guide. Use list_guides to discover available ids.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('Guide id, e.g. "docker-build". Use list_guides to see all available ids.'),
        query: z
          .string()
          .min(1)
          .describe("Your specific task or question within the guide's domain"),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Number of documents to include (default: 5)"),
      },
    },
    async ({ id, query, top_k }) => {
      const guide = guidesLoader.get(id);

      if (!guide) {
        return {
          content: [{ type: "text", text: `Guide not found: ${id}` }],
          isError: true,
        };
      }

      const filterTags = guide.tags.length > 0 ? guide.tags : undefined;
      const results = await indexer.search(query, top_k ?? 5, filterTags);

      const parts: string[] = [];

      parts.push(`## Instructions\n\n${guide.instructions}`);

      if (results.length === 0) {
        parts.push("---\n\n*No relevant documents found for this query.*");
      } else {
        for (const result of results) {
          const doc = indexer.getDoc(result.path);
          if (doc) {
            parts.push(`---\n\n## Document: ${result.title}\n\n${doc.content}`);
          }
        }
      }

      return {
        content: [{ type: "text", text: parts.join("\n\n") }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[server] MCP server connected and ready");
}
