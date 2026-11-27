import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RenderedOperation } from "@/lib/activity/operations";
import { ActivityRow } from "./ActivityRow";

const op: RenderedOperation = {
  kind: "received",
  title: "Received",
  description: "from GA5Z…KZVN",
  amount: "12.5",
  assetCode: "USDC",
  sign: "+",
  counterparty: null,
  failed: false,
};

describe("ActivityRow", () => {
  it("shows the headline, description, signed amount and link", () => {
    render(
      <ul>
        <ActivityRow op={op} timestamp="2026-01-02T10:00:00Z" href="/activity/abc" />
      </ul>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/activity/abc");
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("from GA5Z…KZVN");
    expect(screen.getByRole("listitem")).toHaveTextContent("+12.50USDC");
  });

  it("marks failed operations and suspicious flags", () => {
    render(
      <ul>
        <ActivityRow op={{ ...op, failed: true }} timestamp="2026-01-02T10:00:00Z" flags={["dust"]} />
      </ul>,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Dust")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
