import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale, translateErrorCode } from ".";
import { formatMessage } from "./format";
import en from "./messages/en.json";

describe("formatMessage", () => {
  it("fills placeholders, plurals and selects", () => {
    expect(formatMessage("Hi {name}", { name: "Ada" })).toBe("Hi Ada");
    expect(formatMessage("{n, plural, =0 {none} one {# item} other {# items}}", { n: 0 })).toBe("none");
    expect(formatMessage("{n, plural, =0 {none} one {# item} other {# items}}", { n: 1200 })).toBe("1,200 items");
    expect(formatMessage("{s, select, a {Alpha} other {Other}}", { s: "b" })).toBe("Other");
    expect(formatMessage("Keep {missing}", {})).toBe("Keep {missing}");
  });
});

describe("translations", () => {
  it("resolves supported locales with English fallback", () => {
    expect(resolveLocale(undefined, "en-GB")).toBe("en");
    expect(resolveLocale("fr", "de-DE")).toBe("en");
  });

  it("translates keys and formats variables", () => {
    const t = createTranslator("en");
    expect(t("nav.settings")).toBe("Settings");
    expect(t("devices.count", { count: 2 })).toBe("2 devices");
    expect(createTranslator("xx")("nav.dashboard")).toBe("Dashboard");
  });

  it("reuses the shared API error catalogue", () => {
    expect(translateErrorCode("VALIDATION_ERROR")).toBe("The request contains invalid or missing fields.");
    expect(translateErrorCode("NOT_A_CODE")).toBeNull();
  });

  it("has no empty strings in the English catalogue", () => {
    expect(Object.values(en).every((value) => value.trim().length > 0)).toBe(true);
  });
});
