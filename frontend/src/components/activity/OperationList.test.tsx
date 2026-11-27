import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HistoryItem } from "@/lib/api/endpoints/transactions";
import { OperationList } from "./OperationList";

const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const op = (partial: Partial<HistoryItem>): HistoryItem => ({
  id: "1",
  pagingToken: "1",
  type: "payment",
  operationType: "payment",
  direction: "in",
  amount: "3",
  asset: { id: "XLM", type: "native", code: "XLM", issuer: null },
  sourceAmount: null,
  sourceAsset: null,
  counterparty: OTHER,
  trustlineLimit: null,
  contractFunction: null,
  memo: null,
  memoType: null,
  fee: null,
  feePayer: null,
  transactionHash: "a".repeat(64),
  transactionOperationCount: 2,
  createdAt: "2026-01-01T00:00:00Z",
  successful: true,
  ...partial,
});

describe("OperationList", () => {
  it("lists each operation with its readable title and raw type", () => {
    render(
      <OperationList
        operations={[op({}), op({ id: "2", type: "other", operationType: "set_options", amount: null, counterparty: null })]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Received");
    expect(items[0]).toHaveTextContent("+3XLM");
    expect(items[1]).toHaveTextContent("Changed account settings");
    expect(items[1]).toHaveTextContent("Set options");
  });

  it("explains when the backend returned no operations", () => {
    render(<OperationList operations={[]} />);
    expect(screen.getByText(/No operation details/)).toBeInTheDocument();
  });
});
