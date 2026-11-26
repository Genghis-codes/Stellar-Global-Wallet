import { vi } from "vitest";

/** A JSON Response, as the backend would send it. */
export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** The backend error envelope. */
export function errorResponse(status: number, code: string, message = code, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error: { code, message, requestId: "req-1", ...extra } }, { status });
}

/** A fetch mock that answers queued responses in order and records calls. */
export function mockFetch(...responses: Array<Response | Error>) {
  const queue = [...responses];
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: no response queued");
    if (next instanceof Error) throw next;
    return next;
  });
  return fn;
}

/** Headers of the nth recorded fetch call, as a plain object. */
export function callHeaders(fn: ReturnType<typeof mockFetch>, index = 0): Record<string, string> {
  const init = fn.mock.calls[index]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}
