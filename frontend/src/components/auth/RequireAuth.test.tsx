import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthContextValue } from "./AuthProvider";
import { RequireAuth, safeNextPath } from "./RequireAuth";

const replace = vi.fn();
let auth: Partial<AuthContextValue> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/dashboard",
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth }));

beforeEach(() => replace.mockReset());

describe("RequireAuth", () => {
  it("renders children for a signed-in user", () => {
    auth = { status: "signedIn" };
    render(<RequireAuth>secret</RequireAuth>);
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a spinner while loading", () => {
    auth = { status: "loading" };
    render(<RequireAuth>secret</RequireAuth>);
    expect(screen.getByRole("status", { name: "Checking your session" })).toBeInTheDocument();
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("redirects signed-out visitors to the connect page", () => {
    auth = { status: "signedOut" };
    render(<RequireAuth>secret</RequireAuth>);
    expect(replace).toHaveBeenCalledWith("/?next=%2Fdashboard");
  });

  it("keeps the query string in the post-login redirect", () => {
    auth = { status: "signedOut" };
    window.history.pushState({}, "", "/dashboard?uri=web%2Bstellar%3Apay");
    render(<RequireAuth>secret</RequireAuth>);
    expect(replace).toHaveBeenCalledWith(`/?next=${encodeURIComponent("/dashboard?uri=web%2Bstellar%3Apay")}`);
    window.history.pushState({}, "", "/");
  });
});

describe("safeNextPath", () => {
  it("allows relative paths and rejects external ones", () => {
    expect(safeNextPath("/assets?x=1")).toBe("/assets?x=1");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});
