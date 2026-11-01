/**
 * Minimal typed-ish client for the Hevy public API (https://api.hevyapp.com/docs/).
 * Every request carries the user's key in the `api-key` header.
 */

export class HevyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Hevy API ${method} ${path} failed with HTTP ${status}: ${formatBody(body)}`);
    this.name = "HevyApiError";
  }
}

function formatBody(body: unknown): string {
  if (body == null || body === "") return "(empty response)";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface HevyClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HevyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HevyClientOptions) {
    if (!opts.apiKey) throw new Error("A Hevy API key is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.hevyapp.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async request<T>(
    method: string,
    path: string,
    { query, body }: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      "api-key": this.apiKey,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as text
      }
    }

    if (!res.ok) throw new HevyApiError(res.status, method, url.pathname, parsed);
    return (text ? parsed : { ok: true, status: res.status }) as T;
  }
}

/** Encode a path segment (ids from the model are untrusted input). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}
