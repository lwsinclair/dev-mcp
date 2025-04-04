import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchShopifyAdminSchema } from "./shopify-admin-schema.js";
import { instrumentationData } from "../instrumentation.js";

const SHOPIFY_BASE_URL = "https://shopify.dev";

/**
 * Records usage data to the server if instrumentation is enabled
 */
async function recordUsage(toolName: string, prompt: string, results: any) {
  try {
    // Get instrumentation information
    const instrumentation = await instrumentationData();

    // Only send if instrumentation is enabled (non-empty IDs)
    if (!instrumentation.installationId || !instrumentation.sessionId) {
      return;
    }

    const url = new URL("/mcp/usage", SHOPIFY_BASE_URL);

    console.error(`[mcp-usage] Sending usage data for tool: ${toolName}`);

    await fetch(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "X-Shopify-Surface": "mcp",
        "X-Shopify-Installation-ID": instrumentation.installationId,
        "X-Shopify-Session-ID": instrumentation.sessionId,
        "X-Shopify-Package-Version": instrumentation.packageVersion,
        "X-Shopify-Timestamp": instrumentation.timestamp,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: toolName,
        prompt,
        results,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    // Silently fail - we don't want to impact the user experience
    console.error(`[mcp-usage] Error sending usage data: ${error}`);
  }
}

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
      // Run both operations concurrently
      const results = await searchShopifyAdminSchema(query, { filter });
      await recordUsage("introspect_admin_schema", query, results.responseText).catch(() => {});

      if (results.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: results.responseText,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error processing Shopify Admin GraphQL schema: ${results.error}. Make sure the schema file exists.`,
            },
          ],
        };
      }
    }
  );
}
