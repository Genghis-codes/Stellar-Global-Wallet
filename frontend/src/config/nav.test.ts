import { describe, expect, it } from "vitest";
import { HomeIcon } from "@/components/icons";
import { isNavItemActive, type NavItem } from "./nav";

const item: NavItem = { href: "/assets", label: "Assets", icon: HomeIcon, match: ["/trustlines"] };

describe("isNavItemActive", () => {
  it("matches the route, its children and extra prefixes", () => {
    expect(isNavItemActive(item, "/assets")).toBe(true);
    expect(isNavItemActive(item, "/assets/USDC")).toBe(true);
    expect(isNavItemActive(item, "/trustlines/new")).toBe(true);
  });

  it("does not match sibling routes sharing a prefix", () => {
    expect(isNavItemActive(item, "/assetsx")).toBe(false);
    expect(isNavItemActive(item, "/")).toBe(false);
  });
});
