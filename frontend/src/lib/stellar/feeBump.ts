import { FeeBumpTransaction, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

/**
 * Client-side fee bumps. The backend only relays envelopes it built and
 * matches the *inner* transaction hash, so raising the fee of a built
 * transaction means wrapping the signed envelope in a fee-bump envelope
 * (paid by the user's own account) rather than editing it.
 */

function parse(xdr: string, networkPassphrase: string): Transaction | FeeBumpTransaction {
  return TransactionBuilder.fromXDR(xdr, networkPassphrase);
}

/** Per-operation fee (stroops) a plain or fee-bump envelope offers. */
export function feePerOperation(xdr: string, networkPassphrase: string): bigint {
  const tx = parse(xdr, networkPassphrase);
  if (tx instanceof FeeBumpTransaction) {
    // A fee bump pays for the inner operations plus itself.
    return BigInt(tx.fee) / BigInt(tx.innerTransaction.operations.length + 1);
  }
  return BigInt(tx.fee) / BigInt(Math.max(tx.operations.length, 1));
}

/** True when `perOperationFee` is more than the envelope already offers. */
export function needsFeeBump(xdr: string, networkPassphrase: string, perOperationFee: string | bigint): boolean {
  return BigInt(perOperationFee) > feePerOperation(xdr, networkPassphrase);
}

/**
 * Wrap a signed transaction in an unsigned fee-bump envelope paying
 * `perOperationFee` stroops per operation from `feeSource`. Pass an existing
 * fee bump to bump it again: its inner transaction is re-wrapped.
 */
export function buildFeeBump(
  signedXdr: string,
  feeSource: string,
  perOperationFee: string | bigint,
  networkPassphrase: string,
): string {
  const tx = parse(signedXdr, networkPassphrase);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  if (inner.signatures.length === 0) throw new Error("Sign the transaction before bumping its fee.");
  return TransactionBuilder.buildFeeBumpTransaction(feeSource, String(perOperationFee), inner, networkPassphrase).toXDR();
}

/** Total fee in stroops a fee bump of `perOperationFee` costs for `xdr`. */
export function feeBumpTotal(xdr: string, networkPassphrase: string, perOperationFee: string | bigint): bigint {
  const tx = parse(xdr, networkPassphrase);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  return BigInt(perOperationFee) * BigInt(inner.operations.length + 1);
}
