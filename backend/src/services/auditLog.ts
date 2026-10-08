import { createHash } from "crypto";
import { pool } from "../db";

export async function logKeypairIssuance(
  apiKey: string,
  publicKey: string
): Promise<void> {
  const hash = createHash("sha256").update(apiKey).digest("hex");
  await pool.query(
    `INSERT INTO keypair_audit_log (api_key_hash, public_key) VALUES ($1, $2)`,
    [hash, publicKey]
  );
}
