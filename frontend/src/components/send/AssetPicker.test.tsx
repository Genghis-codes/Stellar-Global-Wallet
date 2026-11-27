import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { AssetPicker, assetOptions } from "./AssetPicker";

const ISSUER_A = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER_B = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

const balances: ReservesResponse["balances"] = [
  { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER_B, balance: "5", spendable: "5" },
  { asset_type: "native", balance: "100", spendable: "98.5" },
  { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER_A, balance: "1", spendable: "1" },
  { asset_type: "credit_alphanum4", asset_code: "FRZN", asset_issuer: ISSUER_A, balance: "9", spendable: "9", is_authorized: false },
  { asset_type: "liquidity_pool_shares", liquidity_pool_id: "abc", balance: "3", spendable: "3" },
];

describe("assetOptions", () => {
  it("keeps sendable assets, native first, without pool shares or unauthorized lines", () => {
    expect(assetOptions(balances).map((option) => option.id)).toEqual(["XLM", `USDC:${ISSUER_A}`, `USDC:${ISSUER_B}`]);
  });
});

describe("AssetPicker", () => {
  it("shows available amounts and disambiguates duplicate codes by issuer", async () => {
    const onChange = vi.fn();
    render(<AssetPicker options={assetOptions(balances)} value="XLM" onChange={onChange} />);

    expect(screen.getByRole("option", { name: "XLM · 98.5 available" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /USDC \(GBRP…OX2H\)/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Asset"), `USDC:${ISSUER_B}`);
    expect(onChange).toHaveBeenCalledWith(`USDC:${ISSUER_B}`);
  });
});
