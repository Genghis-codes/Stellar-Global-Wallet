import { describe, expect, it, vi } from "vitest";
import { MemoryTokenStore, WebStorageTokenStore } from "./tokens";

const tokens = { accessToken: "a", refreshToken: "r", account: "GABC" };

describe("MemoryTokenStore", () => {
  it("stores, clears and notifies subscribers", () => {
    const store = new MemoryTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(tokens);
    expect(store.get()).toEqual(tokens);
    store.clear();
    expect(store.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set(tokens);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("WebStorageTokenStore", () => {
  it("persists to and restores from storage", () => {
    new WebStorageTokenStore(() => window.sessionStorage).set(tokens);
    expect(JSON.parse(window.sessionStorage.getItem("gw.session")!)).toEqual(tokens);
    expect(new WebStorageTokenStore(() => window.sessionStorage).get()).toEqual(tokens);
  });

  it("ignores corrupt or incomplete stored values", () => {
    window.sessionStorage.setItem("gw.session", "{not json");
    expect(new WebStorageTokenStore(() => window.sessionStorage).get()).toBeNull();
    window.sessionStorage.setItem("gw.session", JSON.stringify({ accessToken: "a" }));
    expect(new WebStorageTokenStore(() => window.sessionStorage).get()).toBeNull();
  });

  it("works without storage (SSR)", () => {
    const store = new WebStorageTokenStore(() => undefined);
    expect(store.get()).toBeNull();
    store.set(tokens);
    expect(store.get()).toEqual(tokens);
    store.clear();
    expect(store.get()).toBeNull();
  });
});
