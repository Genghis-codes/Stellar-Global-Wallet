import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { MuxedAddressGenerator } from "./MuxedAddressGenerator";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const M = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAGZFQ";

afterEach(() => vi.restoreAllMocks());

describe("MuxedAddressGenerator", () => {
  it("derives a muxed address for the entered id", async () => {
    const muxed = vi.spyOn(api.account, "muxed").mockResolvedValue({ address: M, baseAccount: G, id: "1001" });
    renderWithProviders(<MuxedAddressGenerator account={G} />);

    await userEvent.type(screen.getByLabelText("ID"), "1001");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("Muxed address for ID 1001")).toBeInTheDocument();
    expect(screen.getByText(M)).toBeInTheDocument();
    expect(muxed).toHaveBeenCalledWith(G, "1001");
  });

  it("rejects ids that are not uint64", async () => {
    const muxed = vi.spyOn(api.account, "muxed");
    renderWithProviders(<MuxedAddressGenerator account={G} />);

    await userEvent.type(screen.getByLabelText("ID"), "18446744073709551616");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByText(/must fit in 64 bits/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("ID"));
    await userEvent.type(screen.getByLabelText("ID"), "-3");
    expect(screen.getByText(/whole number/)).toBeInTheDocument();
    expect(muxed).not.toHaveBeenCalled();
  });
});
