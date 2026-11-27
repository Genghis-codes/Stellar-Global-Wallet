import { describe, expect, it } from "vitest";
import { errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { isSubmitPending, multisigApi } from "./multisig";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const S2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, multisig: multisigApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

describe("multisigApi", () => {
  it("reads thresholds", async () => {
    const body = { lowThreshold: 1, mediumThreshold: 2, highThreshold: 3, signers: [{ key: G, weight: 1 }] };
    const { fetch, multisig } = setup(jsonResponse(body));
    await expect(multisig.thresholds(G)).resolves.toEqual(body);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/${G}/thresholds`);
  });

  it("builds a set-options change", async () => {
    const result = {
      xdr: "AAAA",
      networkPassphrase: "Test SDF Network ; September 2015",
      warnings: [],
      resultingSigners: [
        { key: G, weight: 1 },
        { key: S2, weight: 1 },
      ],
      resultingThresholds: { low: 1, medium: 2, high: 2 },
    };
    const { fetch, multisig } = setup(jsonResponse(result));
    await expect(
      multisig.buildSetOptions({ sourcePublicKey: G, addSigners: [{ key: S2, weight: 1 }], highThreshold: 2 }),
    ).resolves.toEqual(result);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/wallet/set-options/build");
    expect(JSON.parse(String(init?.body))).toEqual({
      sourcePublicKey: G,
      addSigners: [{ key: S2, weight: 1 }],
      highThreshold: 2,
    });
  });

  it("maps a lock-out refusal to its error code", async () => {
    const { multisig } = setup(errorResponse(422, "SET_OPTIONS_LOCKOUT", "This change would lock the account out"));
    await expect(multisig.buildSetOptions({ sourcePublicKey: G, highThreshold: 9 })).rejects.toMatchObject({
      code: "SET_OPTIONS_LOCKOUT",
      status: 422,
    });
  });

  it("submits with an optional idempotency key", async () => {
    const { fetch, multisig } = setup(
      jsonResponse({ hash: "h1", ledger: 5, successful: true }),
      jsonResponse({ hash: "h2", status: "pending" }, { status: 202 }),
    );
    const done = await multisig.submit("SIGNED");
    expect(isSubmitPending(done)).toBe(false);
    expect(fetch.mock.calls[0]![1]?.body).toBe('{"signedXdr":"SIGNED"}');
    const pending = await multisig.submit("SIGNED", "key-1");
    expect(isSubmitPending(pending)).toBe(true);
    expect(fetch.mock.calls[1]![1]?.body).toBe('{"signedXdr":"SIGNED","idempotencyKey":"key-1"}');
  });
});
