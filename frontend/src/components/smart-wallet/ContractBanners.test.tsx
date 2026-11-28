import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { AppConfigResponse, PendingUpgrade } from "@/lib/api/endpoints/config";
import { renderWithProviders } from "@/test/render";
import { ContractBanners } from "./ContractBanners";

const ADMIN = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const CANDIDATE = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
const auth = { account: ADMIN };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: auth.account, wallet: { signTransaction } }) }));

function mockConfig(pendingUpgrade: PendingUpgrade | null, contract = true) {
  vi.spyOn(api.config, "get").mockResolvedValue({
    contracts: { globeWallet: { contractId: "C", pendingUpgrade }, tokenWrapper: null },
    features: { contract },
  } as unknown as AppConfigResponse);
}

beforeEach(() => {
  vi.restoreAllMocks();
  auth.account = ADMIN;
  vi.spyOn(api.contract, "status").mockResolvedValue({ sendsPaused: false, pauser: null });
});

describe("ContractBanners", () => {
  it("announces a queued upgrade with a countdown", async () => {
    mockConfig({
      wasmHash: "ab".repeat(32),
      proposedBy: ADMIN,
      readyAtLedger: 900,
      executableAt: new Date(Date.now() + 2 * 3600_000 + 30_000).toISOString(),
    });
    vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: null });
    renderWithProviders(<ContractBanners />);
    expect(await screen.findByText(/contract upgrade is queued/)).toHaveTextContent("2h 00m");
  });

  it("lets the candidate accept a pending admin transfer", async () => {
    auth.account = CANDIDATE;
    mockConfig(null);
    vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: CANDIDATE });
    const build = vi.spyOn(api.contract, "buildAcceptAdmin").mockResolvedValue({ xdr: "TX" });
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<ContractBanners />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Accept admin role" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(CANDIDATE));
    expect(await screen.findByText("You are now the admin")).toBeInTheDocument();
  });

  it("lets the admin cancel the transfer and warns about paused sends", async () => {
    mockConfig(null);
    vi.spyOn(api.contract, "status").mockResolvedValue({ sendsPaused: true, pauser: ADMIN });
    vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: CANDIDATE });
    renderWithProviders(<ContractBanners />);
    expect(await screen.findByRole("button", { name: "Cancel transfer" })).toBeInTheDocument();
    expect(screen.getByText(/Sends from the smart wallet are paused/)).toBeInTheDocument();
  });

  it("renders nothing without a contract", async () => {
    mockConfig(null, false);
    vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: CANDIDATE });
    renderWithProviders(<ContractBanners />);
    await waitFor(() => expect(api.config.get).toHaveBeenCalled());
    await waitFor(() => expect(api.contract.admin).toHaveBeenCalled());
    expect(screen.queryByText(/Admin transfer pending/)).not.toBeInTheDocument();
  });
});
