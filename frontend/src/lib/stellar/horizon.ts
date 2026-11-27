import { env } from "@/lib/env";

/**
 * Read-only Horizon lookups for data the backend doesn't expose. The
 * backend's GET /transactions/:hash omits the envelope signatures, so the
 * detail page reads them from Horizon (NEXT_PUBLIC_HORIZON_URL) directly.
 */

export async function fetchTransactionSignatures(
  hash: string,
  { signal, horizonUrl = env.horizonUrl, fetchImpl = fetch }: { signal?: AbortSignal; horizonUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const response = await fetchImpl(`${horizonUrl}/transactions/${encodeURIComponent(hash.toLowerCase())}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Horizon answered ${response.status}`);
  const body = (await response.json()) as { signatures?: unknown };
  return Array.isArray(body.signatures) ? body.signatures.filter((s): s is string => typeof s === "string") : [];
}
