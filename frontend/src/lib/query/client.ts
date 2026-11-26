import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";

const MAX_RETRIES = 2;

/**
 * Retry only failures that can succeed on a second try: network errors,
 * timeouts, 429 and 5xx (ApiError.retryable). 4xx responses, cancelled
 * requests and expired sessions fail immediately.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (isApiError(error)) return error.retryable && error.code !== "ABORTED";
  return false;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
