import { StrKey } from "@stellar/stellar-sdk";

/** Ed25519 account id (G...). */
export function isAccountId(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

/** Muxed account (M...). */
export function isMuxedAddress(value: string): boolean {
  return StrKey.isValidMed25519PublicKey(value);
}

/** Soroban contract id (C...). */
export function isContractId(value: string): boolean {
  return StrKey.isValidContract(value);
}

/** Federation address (name*domain.tld), resolved server-side via /api/v1/resolve. */
export function isFederationAddress(value: string): boolean {
  return /^[^*\s]+\*[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value);
}
