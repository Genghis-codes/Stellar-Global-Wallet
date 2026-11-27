/**
 * Build metadata. NEXT_PUBLIC_APP_VERSION is filled from package.json by
 * next.config.ts; NEXT_PUBLIC_COMMIT_SHA can be set by CI/deploys.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
export const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA || null;

function parts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/, "")
    .split(/[-+]/)[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Compare dotted versions numerically (pre-release/build suffixes ignored): -1, 0 or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the server requires a newer client than `current`. */
export function isClientOutdated(current: string, minClientVersion: string | undefined): boolean {
  return Boolean(minClientVersion) && compareVersions(current, minClientVersion!) < 0;
}
