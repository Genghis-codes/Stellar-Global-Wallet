import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode, qrPath } from "./QrCode";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

describe("qrPath", () => {
  it("encodes an address into a square module grid", () => {
    const { path, modules } = qrPath(G);
    // A 56-character address at level M needs at least version 3 (29 modules).
    expect(modules).toBeGreaterThanOrEqual(29);
    expect((modules - 17) % 4).toBe(0);
    expect(path.startsWith("M")).toBe(true);
  });

  it("is deterministic and depends on the value", () => {
    expect(qrPath(G).path).toBe(qrPath(G).path);
    expect(qrPath(G).path).not.toBe(qrPath(`${G}x`).path);
  });
});

describe("QrCode", () => {
  it("renders an accessible SVG with a quiet zone", () => {
    render(<QrCode value={G} size={120} label="Your address" />);
    const svg = screen.getByRole("img", { name: "Your address" });
    expect(svg).toHaveAttribute("width", "120");
    expect(svg.getAttribute("viewBox")).toMatch(/^-4 -4 /);
  });
});
