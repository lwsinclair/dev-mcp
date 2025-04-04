import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchShopifyAdminSchema } from "./shopify-admin-schema.js";
import { instrumentationData } from "../instrumentation.js";

const SHOPIFY_BASE_URL = "https://shopify.dev";
const MCP_VERSION = process.env.npm_package_version ?? "unknown";

/**
 * Searches Shopify documentation with the given query
 * @param prompt The search query for Shopify documentation
 * @returns The formatted response or error message
 */
export async function searchShopifyDocs(prompt: string) {
  try {
    // Get instrumentation information
    const instrumentation = await instrumentationData();

    // Prepare the URL with query parameters
    const url = new URL("/mcp/search", SHOPIFY_BASE_URL);
    url.searchParams.append("query", prompt);

    console.error(`[shopify-docs] Making GET request to: ${url.toString()}`);

    // Make the GET request
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "X-Shopify-Surface": "mcp",
        "X-Shopify-MCP-Version": "1.0.0",
        "X-Shopify-Installation-ID": instrumentation.installationId,
        "X-Shopify-Session-ID": instrumentation.sessionId,
        "X-Shopify-Package-Version": instrumentation.packageVersion,
        "X-Shopify-Timestamp": instrumentation.timestamp
      },
    });

    console.error(
      `[shopify-docs] Response status: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      console.error(`[shopify-docs] HTTP error status: ${response.status}`);
      return {
        success: false,
        formattedText: `HTTP error! status: ${response.status}`
      };
    }

    // Try to parse as JSON first
    try {
      const jsonData = await response.json();
      return {
        success: true,
        formattedText: JSON.stringify(jsonData, null, 2)
      };
    } catch (e) {
      // If JSON parsing fails, get the raw text
      const responseText = await response.text();
      return {
        success: true,
        formattedText: responseText
      };
    }
  } catch (error) {
    console.error(
      `[shopify-docs] Error searching Shopify documentation: ${error}`
    );

    return {
      success: false,
      formattedText: error instanceof Error ? error.message : String(error)
    };
  }
}

export function shopifyTools(server: McpServer) {
  server.tool(
    "introspect_admin_schema",
    `This tool introspects and returns the portion of the Shopify Admin API GraphQL schema relevant to the user prompt. Only use this for the Shopify Admin API, and not any other APIs like the Shopify Storefront API or the Shopify Functions API.

    It takes two arguments: query and filter. The query argument is the string search term to filter schema elements by name. The filter argument is an array of strings to filter results to show specific sections.`,
    {
      query: z
        .string()
        .describe(
          "Search term to filter schema elements by name. Only pass simple terms like 'product', 'discountProduct', etc."
        ),
      filter: z
        .array(z.enum(["all", "types", "queries", "mutations"]))
        .optional()
        .default(["all"])
        .describe(
          "Filter results to show specific sections. Can include 'types', 'queries', 'mutations', or 'all' (default)"
        ),
    },
    async ({ query, filter }, extra) => {
      const result = await searchShopifyAdminSchema(query, { filter });

      if (result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: result.responseText,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error processing Shopify Admin GraphQL schema: ${result.error}. Make sure the schema file exists.`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "search_dev_docs",
    `This tool will take in the user prompt, search shopify.dev, and return relevant documentation that will help answer the user's question.

    It takes one argument: prompt, which is the search query for Shopify documentation.`,
    {
      prompt: z.string().describe("The search query for Shopify documentation"),
    },
    async ({ prompt }, extra) => {
      const result = await searchShopifyDocs(prompt);

      return {
        content: [
          {
            type: "text" as const,
            text: result.formattedText,
          },
        ],
      };
    }
  );
}
