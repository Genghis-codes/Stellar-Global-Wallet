import { describe, expect, it } from "vitest";
import { HomeIcon } from "@/components/icons";
import { createTranslator } from "@/lib/i18n";
import { NAV_ITEMS, groupNavItems, isNavItemActive, type NavItem } from "./nav";

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

describe("NAV_ITEMS translations", () => {
  it("has an English string for every label key, matching the fallback label", () => {
    const t = createTranslator("en");
    for (const entry of NAV_ITEMS) {
      if (entry.labelKey) expect(t(entry.labelKey)).toBe(entry.label);
    }
  });
});

describe("groupNavItems", () => {
  it("groups consecutive items by section", () => {
    const items: NavItem[] = [
      { href: "/a", label: "A", icon: HomeIcon },
      { href: "/s1", label: "S1", icon: HomeIcon, sectionKey: "nav.section.security" },
      { href: "/s2", label: "S2", icon: HomeIcon, sectionKey: "nav.section.security" },
      { href: "/b", label: "B", icon: HomeIcon },
    ];
    expect(groupNavItems(items).map((g) => [g.section, g.items.map((i) => i.href)])).toEqual([
      [undefined, ["/a"]],
      ["nav.section.security", ["/s1", "/s2"]],
      [undefined, ["/b"]],
    ]);
  });

  it("puts Signers, Pending and Smart wallet under Security", () => {
    const security = groupNavItems(NAV_ITEMS).find((g) => g.section === "nav.section.security");
    expect(security?.items.map((i) => i.href)).toEqual(["/security/signers", "/security/pending", "/security/smart-wallet"]);
  });
});
