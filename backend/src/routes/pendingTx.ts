import { Router } from "express";
import { body, param, query } from "express-validator";
import { config } from "../config";
import { pool } from "../db";
import { AppError, ForbiddenError, NotFoundError } from "../errors/appError";
import { jwtAuth } from "../middleware/jwtAuth";
import { assertValidRequest } from "../middleware/requestValidation";
import type { StellarService } from "../services/stellar";
import {
  AccountSigners,
  PendingTx,
  PendingTxStore,
  PgPendingTxStore,
  expiryOf,
  mergeSignatures,
  parseClassicTransaction,
  requiredWeightFor,
  verifiedSigners,
  weightOf,
} from "../services/pendingTxs";
import { isGAddress, publicKeyMessage } from "../utils/stellarAddress";

type SignerSource = Pick<StellarService, "getAccountThresholds">;

/**
 * #74 — pending multisig transaction store for co-signers.
 *
 *   POST   /                 { xdr }  share a partially signed transaction
 *   GET    /?account=G...            list open transactions for an account
 *   GET    /:id                      fetch one (to sign client-side)
 *   POST   /:id/signatures   { xdr }  add your signatures from a signed copy
 *   DELETE /:id                      cancel (creator only)
 *
 * Only signers of the transaction's source account can create, read or
 * sign. Signatures are verified against the account's current signer list,
 * so weight can't be faked by attaching arbitrary signatures.
 */
export function createPendingTxRouter(
  stellar: SignerSource,
  store: PendingTxStore = new PgPendingTxStore(pool),
  networkPassphrase: string = config.NETWORK_PASSPHRASE
): Router {
  const router = Router();
  router.use(jwtAuth);

  async function signersOf(account: string): Promise<AccountSigners> {
    try {
      return await stellar.getAccountThresholds(account);
    } catch {
      throw new AppError("Source account not found on the network", {
        code: "SOURCE_ACCOUNT_NOT_FOUND",
        status: 404,
      });
    }
  }

  function assertSigner(account: AccountSigners, sub: string): void {
    if (!account.signers.some((s) => s.key === sub && s.weight > 0)) {
      throw new ForbiddenError("Only signers of the source account can access this transaction");
    }
  }

  function view(row: PendingTx, account: AccountSigners) {
    const tx = parseClassicTransaction(row.xdr, networkPassphrase);
    return {
      ...row,
      hash: tx.hash().toString("hex"),
      collectedWeight: weightOf(row.collectedSigners, account),
    };
  }

  async function load(id: string, sub: string) {
    const row = await store.get(id);
    if (!row) throw new NotFoundError("Pending transaction not found");
    const account = await signersOf(row.account);
    assertSigner(account, sub);
    return { row, account };
  }

  router.post("/", body("xdr").isString().notEmpty(), async (req, res, next) => {
    try {
      assertValidRequest(req);
      const sub = req.user!.sub;
      const tx = parseClassicTransaction(req.body.xdr, networkPassphrase);
      const account = await signersOf(tx.source);
      assertSigner(account, sub);

      const required = requiredWeightFor(tx, account);
      const signers = verifiedSigners(tx, account);
      const row = await store.create({
        account: tx.source,
        xdr: tx.toXDR(),
        requiredWeight: required,
        collectedSigners: signers,
        createdBy: sub,
        expiresAt: expiryOf(tx),
        status: weightOf(signers, account) >= required ? "ready" : "pending",
      });
      res.status(201).json(view(row, account));
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/",
    query("account").isString().bail().custom(isGAddress).withMessage(publicKeyMessage),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const accountId = String(req.query.account);
        const account = await signersOf(accountId);
        assertSigner(account, req.user!.sub);
        const rows = await store.listForAccount(accountId);
        res.json({ items: rows.map((row) => view(row, account)) });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/:id", param("id").isString(), async (req, res, next) => {
    try {
      const { row, account } = await load(req.params.id, req.user!.sub);
      res.json(view(row, account));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/signatures",
    body("xdr").isString().notEmpty(),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const { row, account } = await load(req.params.id, req.user!.sub);
        if (row.status !== "pending" && row.status !== "ready") {
          throw new AppError(`Pending transaction is ${row.status}`, {
            code: "TX_EXPIRED",
            status: 409,
          });
        }
        const merged = mergeSignatures(
          parseClassicTransaction(row.xdr, networkPassphrase),
          parseClassicTransaction(req.body.xdr, networkPassphrase)
        );
        const signers = verifiedSigners(merged, account);
        const updated = await store.update(row.id, {
          xdr: merged.toXDR(),
          collectedSigners: signers,
          status: weightOf(signers, account) >= row.requiredWeight ? "ready" : "pending",
        });
        res.json(view(updated, account));
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete("/:id", async (req, res, next) => {
    try {
      const { row, account } = await load(req.params.id, req.user!.sub);
      if (row.createdBy !== req.user!.sub) {
        throw new ForbiddenError("Only the creator can cancel a pending transaction");
      }
      const updated = await store.update(row.id, {
        xdr: row.xdr,
        collectedSigners: row.collectedSigners,
        status: "cancelled",
      });
      res.json(view(updated, account));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
