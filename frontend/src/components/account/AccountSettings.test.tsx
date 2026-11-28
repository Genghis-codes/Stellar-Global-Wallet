import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountSettings } from "./AccountSettings";

describe("AccountSettings", () => {
  it("links to the close-account flow", () => {
    render(<AccountSettings />);
    expect(screen.getByRole("link", { name: "Close account…" })).toHaveAttribute("href", "/account/close");
  });
});
