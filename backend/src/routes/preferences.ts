import { Router } from "express";
import { Pool } from "pg";
import { z } from "zod";
import { pool } from "../db";
import { ValidationError } from "../errors/appError";
import { jwtAuth } from "../middleware/jwtAuth";

// #68 — user preferences. Only these keys are allowed; unknown keys are
// rejected so the stored JSONB stays predictable across web and mobile.
export const preferencesSchema = z
  .object({
    currency: z.string().min(1).max(16).optional(),
    language: z.string().min(2).max(16).optional(),
    hiddenAssets: z.array(z.string().min(1).max(128)).max(500).optional(),
    notifications: z
      .object({
        email: z.boolean().optional(),
        push: z.boolean().optional(),
        payments: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;

export function parsePreferences(input: unknown): Preferences {
  const result = preferencesSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      "Invalid preferences payload"
    );
  }
  return result.data;
}

export async function ensurePreferencesTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      account VARCHAR(56) PRIMARY KEY,
      preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export interface PreferencesStore {
  get(account: string): Promise<Preferences>;
  merge(account: string, patch: Preferences): Promise<Preferences>;
}

export class PgPreferencesStore implements PreferencesStore {
  constructor(private readonly db: Pool) {}

  async get(account: string): Promise<Preferences> {
    const { rows } = await this.db.query<{ preferences: Preferences }>(
      "SELECT preferences FROM user_preferences WHERE account = $1",
      [account]
    );
    return rows[0]?.preferences ?? {};
  }

  /** Shallow-merge `patch` into the stored preferences (PUT semantics per key). */
  async merge(account: string, patch: Preferences): Promise<Preferences> {
    const { rows } = await this.db.query<{ preferences: Preferences }>(
      `INSERT INTO user_preferences (account, preferences)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (account) DO UPDATE
         SET preferences = user_preferences.preferences || EXCLUDED.preferences,
             updated_at = NOW()
       RETURNING preferences`,
      [account, JSON.stringify(patch)]
    );
    return rows[0].preferences;
  }
}

/**
 * GET /api/v1/me/preferences  — the caller's preferences ({} when unset)
 * PUT /api/v1/me/preferences  — set any subset of keys; others are kept
 */
export function createPreferencesRouter(store: PreferencesStore = new PgPreferencesStore(pool)): Router {
  const router = Router();
  router.use(jwtAuth);

  router.get("/", async (req, res, next) => {
    try {
      res.json({ preferences: await store.get(req.user!.sub) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const patch = parsePreferences(req.body);
      res.json({ preferences: await store.merge(req.user!.sub, patch) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
