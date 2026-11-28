import { describe, expect, it } from "vitest";
import { describeCloseStep } from "./closeSteps";

const D = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("describeCloseStep", () => {
  it("describes each close-account operation", () => {
    expect(describeCloseStep({ type: "sendBalance", asset: `USDC:${D}`, amount: "5", destination: D })).toBe("Send 5 USDC to GA5Z…KZVN");
    expect(describeCloseStep({ type: "convertBalance", asset: `EURC:${D}`, amount: "2", minXlm: "9" })).toBe(
      "Convert 2 EURC to XLM (at least 9 XLM)",
    );
    expect(describeCloseStep({ type: "removeTrustline", asset: `USDC:${D}` })).toBe("Remove the USDC trustline");
    expect(describeCloseStep({ type: "cancelOffer", offerId: "7" })).toBe("Cancel open offer #7");
    expect(describeCloseStep({ type: "removeData", name: "config" })).toBe('Delete data entry "config"');
    expect(describeCloseStep({ type: "accountMerge", destination: D })).toContain("Merge the account");
  });
});
