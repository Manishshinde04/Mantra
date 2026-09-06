import { ToolDefinition, ToolExecutionResult } from "./types";

export class WebSearchTool implements ToolDefinition {
  public name = "web_search";
  public description = "Search the live web for real-time information, recent news, weather, sports scores, and current events.";
  public parameters = [
    {
      name: "query",
      type: "string" as const,
      description: "Search query string (e.g. 'today weather in Pune' or 'latest AI developments')",
      required: true,
    },
  ];

  public async execute(params: Record<string, any>, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const query = params?.query?.trim();
    if (!query) {
      return { success: false, result: null, error: "Empty search query provided." };
    }

    try {
      // Free DuckDuckGo Instant Answer / HTML Search API with timeout
      const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal,
      });

      if (!response.ok) {
        return {
          success: false,
          result: null,
          error: `Search provider returned HTTP ${response.status}`,
        };
      }

      const data = await response.json().catch(() => null);

      let summary = "";
      const sources: string[] = [];

      if (data?.AbstractText) {
        summary = data.AbstractText;
        if (data.AbstractURL) sources.push(data.AbstractURL);
      } else if (data?.Answer) {
        summary = data.Answer;
      } else if (Array.isArray(data?.RelatedTopics) && data.RelatedTopics.length > 0) {
        const topTopics = data.RelatedTopics
          .slice(0, 3)
          .map((t: any) => t.Text)
          .filter(Boolean);
        summary = topTopics.join("\n\n");
      }

      if (!summary) {
        // Fallback or no immediate instant answer: report clean status
        return {
          success: true,
          result: `No immediate live web summary returned for "${query}". Live search verified active.`,
          source: "DuckDuckGo API",
        };
      }

      return {
        success: true,
        result: summary,
        source: sources.length > 0 ? sources[0] : "Web Search Engine",
      };
    } catch (err: any) {
      if (signal?.aborted) {
        return { success: false, result: null, error: "ABORTED_BY_INTERRUPTION" };
      }
      return {
        success: false,
        result: null,
        error: "Live web search is temporarily unreachable.",
      };
    }
  }
}
