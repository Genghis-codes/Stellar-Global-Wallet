import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { PendingSubmissions } from "./PendingSubmissions";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const record = (hash: string, status: "pending" | "success") => ({ hash, accountId: G, status, createdAt: "", updatedAt: "" });

beforeEach(() => vi.restoreAllMocks());

describe("PendingSubmissions", () => {
  it("lists in-flight submissions with links to their detail", async () => {
    vi.spyOn(api.transactions, "accountStatuses").mockResolvedValue([record("a".repeat(64), "pending"), record("b".repeat(64), "success")]);
    renderWithProviders(<PendingSubmissions account={G} />);
    expect(await screen.findByText(/1 transaction is waiting/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/activity/${"a".repeat(64)}`);
  });

  it("stays hidden when the backend doesn't track submissions", async () => {
    const statuses = vi.spyOn(api.transactions, "accountStatuses").mockRejectedValue(new ApiError("off", { status: 503, code: "SERVICE_UNAVAILABLE" }));
    renderWithProviders(<PendingSubmissions account={G} />);
    await vi.waitFor(() => expect(statuses).toHaveBeenCalled());
    expect(screen.queryByText(/waiting for the network/)).not.toBeInTheDocument();
  });
});
