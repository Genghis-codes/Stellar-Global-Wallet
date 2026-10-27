import express from "express";
import request from "supertest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createPendingTxRouter } from "../../src/routes/pendingTx";
import { errorHandler } from "../../src/middleware/errorHandler";
import type { PendingTx, PendingTxStore } from "../../src/services/pendingTxs";

jest.mock("../../src/middleware/jwtAuth", () => ({
  jwtAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: req.header("x-test-sub") };
    next();
  },
}));

const owner = Keypair.random();
const cosigner = Keypair.random();
const outsider = Keypair.random();
const passphrase = Networks.TESTNET;

const thresholds = {
  lowThreshold: 1,
  mediumThreshold: 2,
  highThreshold: 2,
  signers: [
    { key: owner.publicKey(), weight: 1 },
    { key: cosigner.publicKey(), weight: 1 },
  ],
};

class MemoryStore implements PendingTxStore {
  rows = new Map<string, PendingTx>();
  async create(row: Omit<PendingTx, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const saved = { ...row, id: String(this.rows.size + 1), createdAt: now, updatedAt: now };
    this.rows.set(saved.id, saved);
    return saved;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listForAccount(account: string) {
    return [...this.rows.values()].filter((r) => r.account === account);
  }
  async update(id: string, patch: Pick<PendingTx, "xdr" | "collectedSigners" | "status">) {
    const updated = { ...this.rows.get(id)!, ...patch };
    this.rows.set(id, updated);
    return updated;
  }
}

function unsignedPayment() {
  return new TransactionBuilder(new Account(owner.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(Operation.payment({ destination: outsider.publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(300)
    .build();
}

function setup() {
  const store = new MemoryStore();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/pending-txs",
    createPendingTxRouter({ getAccountThresholds: async () => thresholds } as any, store, passphrase)
  );
  app.use(errorHandler);
  return { app, store };
}

describe("pending multisig transactions (#74)", () => {
  it("collects signatures until the threshold is met", async () => {
    const { app } = setup();
    const tx = unsignedPayment();
    tx.sign(owner);

    const created = await request(app)
      .post("/api/v1/pending-txs")
      .set("x-test-sub", owner.publicKey())
      .send({ xdr: tx.toXDR() });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "pending", requiredWeight: 2, collectedWeight: 1 });

    const copy = TransactionBuilder.fromXDR(created.body.xdr, passphrase) as any;
    copy.sign(cosigner);
    const signed = await request(app)
      .post(`/api/v1/pending-txs/${created.body.id}/signatures`)
      .set("x-test-sub", cosigner.publicKey())
      .send({ xdr: copy.toXDR() });
    expect(signed.status).toBe(200);
    expect(signed.body.status).toBe("ready");
    expect(signed.body.collectedSigners.sort()).toEqual(
      [owner.publicKey(), cosigner.publicKey()].sort()
    );
  });

  it("ignores signatures from keys that are not account signers", async () => {
    const { app } = setup();
    const tx = unsignedPayment();
    tx.sign(owner);
    tx.sign(outsider);
    const res = await request(app)
      .post("/api/v1/pending-txs")
      .set("x-test-sub", owner.publicKey())
      .send({ xdr: tx.toXDR() });
    expect(res.body.collectedWeight).toBe(1);
    expect(res.body.status).toBe("pending");
  });

  it("hides transactions from non-signers", async () => {
    const { app } = setup();
    const tx = unsignedPayment();
    tx.sign(owner);
    const created = await request(app)
      .post("/api/v1/pending-txs")
      .set("x-test-sub", owner.publicKey())
      .send({ xdr: tx.toXDR() });
    const res = await request(app)
      .get(`/api/v1/pending-txs/${created.body.id}`)
      .set("x-test-sub", outsider.publicKey());
    expect(res.status).toBe(403);
  });

  it("rejects a signed copy of a different transaction", async () => {
    const { app } = setup();
    const tx = unsignedPayment();
    tx.sign(owner);
    const created = await request(app)
      .post("/api/v1/pending-txs")
      .set("x-test-sub", owner.publicKey())
      .send({ xdr: tx.toXDR() });
    const other = new TransactionBuilder(new Account(owner.publicKey(), "5"), {
      fee: "100",
      networkPassphrase: passphrase,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "10" }))
      .setTimeout(300)
      .build();
    other.sign(cosigner);
    const res = await request(app)
      .post(`/api/v1/pending-txs/${created.body.id}/signatures`)
      .set("x-test-sub", cosigner.publicKey())
      .send({ xdr: other.toXDR() });
    expect(res.status).toBe(409);
  });

  it("only lets the creator cancel", async () => {
    const { app } = setup();
    const tx = unsignedPayment();
    const created = await request(app)
      .post("/api/v1/pending-txs")
      .set("x-test-sub", owner.publicKey())
      .send({ xdr: tx.toXDR() });
    const denied = await request(app)
      .delete(`/api/v1/pending-txs/${created.body.id}`)
      .set("x-test-sub", cosigner.publicKey());
    expect(denied.status).toBe(403);
    const ok = await request(app)
      .delete(`/api/v1/pending-txs/${created.body.id}`)
      .set("x-test-sub", owner.publicKey());
    expect(ok.body.status).toBe("cancelled");
  });
});
