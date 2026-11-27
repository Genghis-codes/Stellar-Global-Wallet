// @vitest-environment node
import { Account, Asset, FeeBumpTransaction, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildFeeBump, feeBumpTotal, feePerOperation, needsFeeBump } from "./feeBump";

const source = Keypair.random();
const destination = Keypair.random().publicKey();
const passphrase = Networks.TESTNET;

function payment(fee = "100") {
  return new TransactionBuilder(new Account(source.publicKey(), "41"), { fee, networkPassphrase: passphrase })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1" }))
    .setTimeout(180)
    .build();
}

function signedPayment(fee = "100") {
  const tx = payment(fee);
  tx.sign(source);
  return tx.toXDR();
}

describe("feeBump", () => {
  it("reads the per-operation fee of plain and fee-bump envelopes", () => {
    expect(feePerOperation(payment("250").toXDR(), passphrase)).toBe(250n);
    const bumped = buildFeeBump(signedPayment(), source.publicKey(), "500", passphrase);
    expect(feePerOperation(bumped, passphrase)).toBe(500n);
  });

  it("only asks for a bump when the chosen fee is higher", () => {
    const xdr = payment("100").toXDR();
    expect(needsFeeBump(xdr, passphrase, "100")).toBe(false);
    expect(needsFeeBump(xdr, passphrase, 101n)).toBe(true);
  });

  it("wraps the signed transaction without changing its hash", () => {
    const signed = signedPayment();
    const bumpXdr = buildFeeBump(signed, source.publicKey(), "1000", passphrase);
    const bump = TransactionBuilder.fromXDR(bumpXdr, passphrase) as FeeBumpTransaction;

    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    expect(bump.feeSource).toBe(source.publicKey());
    expect(bump.fee).toBe("2000");
    expect(bump.signatures).toHaveLength(0);
    const original = TransactionBuilder.fromXDR(signed, passphrase);
    expect(Buffer.from(bump.innerTransaction.hash()).toString("hex")).toBe(Buffer.from(original.hash()).toString("hex"));
    expect(feeBumpTotal(signed, passphrase, "1000")).toBe(2000n);
  });

  it("re-wraps the inner transaction of an existing fee bump", () => {
    const first = buildFeeBump(signedPayment(), source.publicKey(), "300", passphrase);
    const second = TransactionBuilder.fromXDR(
      buildFeeBump(first, source.publicKey(), "900", passphrase),
      passphrase,
    ) as FeeBumpTransaction;
    expect(second.fee).toBe("1800");
  });

  it("refuses an unsigned transaction", () => {
    expect(() => buildFeeBump(payment().toXDR(), source.publicKey(), "500", passphrase)).toThrow(/Sign the transaction/);
  });
});
