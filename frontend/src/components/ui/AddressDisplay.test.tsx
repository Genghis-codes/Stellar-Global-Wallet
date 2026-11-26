import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddressDisplay } from "./AddressDisplay";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

describe("AddressDisplay", () => {
  it("truncates with the full address as title and offers copy", () => {
    render(<AddressDisplay address={G} />);
    const text = screen.getByText("GBRP…OX2H");
    expect(text).toHaveAttribute("title", G);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("can render the full address as a link without copy", () => {
    render(<AddressDisplay address={G} full copyable={false} href="https://example.test/a" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.test/a");
    expect(screen.getByText(G)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
