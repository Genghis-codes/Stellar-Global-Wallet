import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, type TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "assets", label: "Assets", content: <p>Asset list</p> },
  { id: "activity", label: "Activity", content: <p>Activity feed</p> },
  { id: "locked", label: "Locked", content: <p>Never</p>, disabled: true },
  { id: "settings", label: "Settings", content: <p>Settings panel</p> },
];

function Harness() {
  const [value, setValue] = useState("assets");
  return <Tabs items={items} value={value} onChange={setValue} aria-label="Wallet" />;
}

describe("Tabs", () => {
  it("shows the selected panel and switches on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Asset list");
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity feed");
  });

  it("moves with arrow keys, skipping disabled tabs and wrapping", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Assets" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Settings panel");
  });
});
