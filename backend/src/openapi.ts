import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Path to backend/openapi.yaml, the contract for every /api/v1 route (#15).
 * Resolved from this file so it works from src/ (tsx, jest) and dist/.
 */
export const OPENAPI_SPEC_PATH = join(__dirname, "..", "openapi.yaml");

/**
 * Read and parse the OpenAPI spec served at /api/openapi.json and rendered
 * by Swagger UI at /api/docs (#16). Called once at startup; a missing or
 * malformed spec fails fast instead of serving broken docs.
 */
export function loadOpenApiSpec(path: string = OPENAPI_SPEC_PATH): Record<string, unknown> {
  const spec: unknown = parse(readFileSync(path, "utf8"));
  if (typeof spec !== "object" || spec === null || !("openapi" in spec)) {
    throw new Error(`${path} is not an OpenAPI document`);
  }
  return spec as Record<string, unknown>;
}
