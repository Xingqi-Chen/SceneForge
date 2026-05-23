type Fetcher = typeof fetch;

type TavilyClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: Fetcher;
};

type TavilySearchOptions = {
  includeDomains?: string[];
  maxResults?: number;
  searchDepth?: "advanced" | "basic" | "fast" | "ultra-fast";
};

type TavilyErrorOptions = {
  details?: unknown;
  statusCode?: number;
};

type TavilySearchResult = {
  content: string;
  score?: number;
  title: string;
  url: string;
};

export type TavilySearchResponse = {
  answer: string;
  query: string;
  results: TavilySearchResult[];
  raw: unknown;
};

export class TavilyApiError extends Error {
  readonly details?: unknown;
  readonly statusCode?: number;

  constructor(message: string, options: TavilyErrorOptions = {}) {
    super(message);
    this.name = "TavilyApiError";
    this.details = options.details;
    this.statusCode = options.statusCode;
  }
}

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(baseUrl: string | undefined) {
  return (baseUrl ?? DEFAULT_TAVILY_BASE_URL).trim().replace(/\/+$/, "");
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function compactText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function normalizeSearchResponse(payload: unknown): TavilySearchResponse {
  if (!isRecord(payload)) {
    throw new TavilyApiError("Tavily response was not a JSON object.", {
      statusCode: 502,
      details: payload,
    });
  }

  const results = Array.isArray(payload.results) ? payload.results : [];

  return {
    answer: compactText(payload.answer, 1000),
    query: compactText(payload.query, 300),
    raw: payload,
    results: results.flatMap((result): TavilySearchResult[] => {
      if (!isRecord(result) || typeof result.url !== "string" || !result.url.trim()) {
        return [];
      }

      return [
        {
          content: compactText(result.content, 900),
          score: typeof result.score === "number" && Number.isFinite(result.score) ? result.score : undefined,
          title: compactText(result.title, 180) || result.url.trim(),
          url: result.url.trim(),
        },
      ];
    }),
  };
}

export function createTavilyClient(options: TavilyClientOptions) {
  const apiKey = options.apiKey.trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;

  if (!apiKey) {
    throw new TavilyApiError("TAVILY_API_KEY is required before calling Tavily.", {
      statusCode: 500,
    });
  }

  return {
    async search(query: string, searchOptions: TavilySearchOptions = {}): Promise<TavilySearchResponse> {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        throw new TavilyApiError("Tavily search query is required.", {
          statusCode: 400,
        });
      }

      const response = await fetcher(`${baseUrl}/search`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: normalizedQuery,
          search_depth: searchOptions.searchDepth ?? "basic",
          max_results: searchOptions.maxResults ?? 5,
          include_answer: "basic",
          include_raw_content: false,
          include_images: false,
          ...(searchOptions.includeDomains && searchOptions.includeDomains.length > 0
            ? { include_domains: searchOptions.includeDomains }
            : {}),
        }),
      });
      const payload = await parseResponse(response);

      if (!response.ok) {
        throw new TavilyApiError("Tavily search request failed.", {
          statusCode: response.status,
          details: payload,
        });
      }

      return normalizeSearchResponse(payload);
    },
  };
}

export type TavilyClient = ReturnType<typeof createTavilyClient>;
