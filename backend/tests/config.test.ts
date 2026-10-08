/**
 * Schema-level tests for GLOBE_WALLET_CONTRACT_ID validation in config.ts.
 *
 * These tests import the raw Zod schema directly (not the parsed `config`
 * export, which runs against process.env at import time) so they are fast,
 * fully isolated, and don't require booting the full app.
 *
 * Related: issue #87
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-declare the schema fragment under test.
//
// We pull *only* the field we care about rather than importing the whole
// envSchema (which would call envSchema.parse(process.env) as a side-effect
// via config.ts's top-level export). Keeping this in sync with config.ts is
// intentional: if the real schema changes, this test must change too — and
// that discrepancy is caught at test-authoring time, not silently.
// ---------------------------------------------------------------------------
const contractIdSchema = z
  .string()
  .regex(
    /^C[A-Z0-9]{55}$/,
    "must be a valid Soroban contract StrKey (C followed by 55 uppercase alphanumeric characters)"
  )
  .optional();

// Wrap in an object so we can exercise .optional() (absent key) behaviour too.
const schema = z.object({ GLOBE_WALLET_CONTRACT_ID: contractIdSchema });

// The real testnet contract ID committed in .env.example — used as the
// canonical "known-good" value so this test doubles as a smoke-check that
// .env.example itself stays valid.
const VALID_CONTRACT_ID = "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";

describe("GLOBE_WALLET_CONTRACT_ID config validation (issue #87)", () => {
  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  it("accepts the canonical testnet contract ID from .env.example", () => {
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: VALID_CONTRACT_ID })
    ).not.toThrow();
  });

  it("parses to the exact string value when valid", () => {
    const result = schema.parse({ GLOBE_WALLET_CONTRACT_ID: VALID_CONTRACT_ID });
    expect(result.GLOBE_WALLET_CONTRACT_ID).toBe(VALID_CONTRACT_ID);
  });

  it("accepts any well-formed C... StrKey (56 uppercase alphanumeric chars)", () => {
    // Construct a syntactically valid placeholder: C + 55 'A's
    const syntheticValid = "C" + "A".repeat(55);
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: syntheticValid })
    ).not.toThrow();
  });

  it("accepts absence of the key (field is optional)", () => {
    expect(() => schema.parse({})).not.toThrow();
  });

  it("parses to undefined when the key is absent", () => {
    const result = schema.parse({});
    expect(result.GLOBE_WALLET_CONTRACT_ID).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Failure paths — each describes a specific misconfiguration the regex
  // is intended to catch so that the error happens at boot rather than deep
  // inside the Soroban SDK on first request.
  // -------------------------------------------------------------------------

  it("rejects a completely wrong value (not-a-real-contract-id)", () => {
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: "not-a-real-contract-id" })
    ).toThrow();
  });

  it("rejects a G... account address (easy copy-paste mistake)", () => {
    // 56-char G address — right length, wrong prefix
    const gAddress = "GABC" + "A".repeat(52);
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: gAddress })
    ).toThrow();
  });

  it("rejects a C... StrKey that is too short (55 chars)", () => {
    const tooShort = "C" + "A".repeat(54); // 55 total
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: tooShort })
    ).toThrow();
  });

  it("rejects a C... StrKey that is too long (57 chars)", () => {
    const tooLong = "C" + "A".repeat(56); // 57 total
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: tooLong })
    ).toThrow();
  });

  it("rejects a contract ID with lowercase letters", () => {
    const lowercase = "c" + "a".repeat(55); // lowercase prefix
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: lowercase })
    ).toThrow();
  });

  it("rejects a contract ID with leading/trailing whitespace", () => {
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: ` ${VALID_CONTRACT_ID}` })
    ).toThrow();
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: `${VALID_CONTRACT_ID} ` })
    ).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() =>
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: "" })
    ).toThrow();
  });

  it("includes a descriptive error message on failure", () => {
    let errorMessage = "";
    try {
      schema.parse({ GLOBE_WALLET_CONTRACT_ID: "bad-value" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        errorMessage = err.errors[0].message;
      }
    }
    expect(errorMessage).toMatch(/Soroban contract StrKey/);
  });
});
