/** Shapes shared by several backend route groups. */

/** Cursor pagination contract (backend/src/routes/account.ts, #24). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageQuery {
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** 1–100, backend default 20. */
  limit?: number;
}

/** A Stellar account id (G...). */
export type AccountId = string;
