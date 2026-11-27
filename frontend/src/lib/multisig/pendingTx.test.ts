// @vitest-environment node
import { Account, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PENDING_STATUS, hasSigned, isOpen, signingProgress, summarizeTransaction } from "./pendingTx";

const source = Keypair.random();
const other = Keypair.random();

function buildTx() {
  const tx = new TransactionBuilder(new Account(source.publicKey(), "41"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "12.5" }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: other.publicKey(), weight: 0 }, highThreshold: 2 }))
    .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
    .addMemo(Memo.text("rent"))
    .setTimeout(300)
    .build();
  tx.sign(source);
  return tx.toXDR();
}

describe("summarizeTransaction", () => {
  it("describes source, memo and each operation", () => {
    const summary = summarizeTransaction(buildTx(), Networks.TESTNET)!;
    expect(summary.source).toBe(source.publicKey());
    expect(summary.sequence).toBe("42");
    expect(summary.fee).toBe("300");
    expect(summary.memo).toBe("rent");
    expect(summary.signatureCount).toBe(1);
    expect(summary.operations.map((op) => op.description)).toEqual([
      `Pay 12.5000000 XLM to ${other.publicKey()}`,
      `Set options: remove signer ${other.publicKey()}, high threshold 2`,
      "Bump Sequence",
    ]);
  });

  it("returns null for junk or the wrong network", () => {
    expect(summarizeTransaction("not-xdr", Networks.TESTNET)).toBeNull();
  });
});

describe("pending status helpers", () => {
  const tx = { status: "pending" as const, collectedSigners: [source.publicKey()], collectedWeight: 1, requiredWeight: 3 };

  it("labels every status", () => {
    expect(PENDING_STATUS.ready).toEqual({ label: "Ready to submit", tone: "success" });
    expect(PENDING_STATUS.expired.tone).toBe("danger");
  });

  it("knows which transactions still take signatures", () => {
    expect(isOpen(tx)).toBe(true);
    expect(isOpen({ status: "ready" })).toBe(true);
    expect(isOpen({ status: "submitted" })).toBe(false);
  });

  it("tracks who signed and how far along it is", () => {
    expect(hasSigned(tx, source.publicKey())).toBe(true);
    expect(hasSigned(tx, other.publicKey())).toBe(false);
    expect(signingProgress(tx)).toBe(33);
    expect(signingProgress({ collectedWeight: 5, requiredWeight: 2 })).toBe(100);
    expect(signingProgress({ collectedWeight: 0, requiredWeight: 0 })).toBe(100);
  });
});
