import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { classifyRecipient, recipientError } from "./recipient";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const M = new MuxedAccount(new Account(G, "0"), "7").accountId();
const C = StrKey.encodeContract(new Uint8Array(32) as Buffer);

describe("classifyRecipient", () => {
  it("recognises every address form", () => {
    expect(classifyRecipient("")).toBe("empty");
    expect(classifyRecipient("   ")).toBe("empty");
    expect(classifyRecipient(` ${G} `)).toBe("account");
    expect(classifyRecipient(M)).toBe("muxed");
    expect(classifyRecipient("alice*example.com")).toBe("federation");
    expect(classifyRecipient(C)).toBe("contract");
    expect(classifyRecipient("hello")).toBe("invalid");
  });
});

describe("recipientError", () => {
  it("accepts payable recipients", () => {
    expect(recipientError(G)).toBeNull();
    expect(recipientError(M)).toBeNull();
    expect(recipientError("alice*example.com")).toBeNull();
  });

  it("explains why a recipient is rejected", () => {
    expect(recipientError("")).toMatch(/Enter a recipient/);
    expect(recipientError(C)).toMatch(/Contract/);
    // One character changed: the checksum no longer matches.
    expect(recipientError(G.slice(0, -1) + (G.endsWith("H") ? "A" : "H"))).toMatch(/checksum/);
    expect(recipientError("alice@example.com")).toMatch(/federation address/);
  });
});
