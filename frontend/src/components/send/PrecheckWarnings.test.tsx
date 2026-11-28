import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrecheckWarnings } from "./PrecheckWarnings";

describe("PrecheckWarnings", () => {
  it("renders nothing without warnings", () => {
    const { container } = render(<PrecheckWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists blocking warnings first and announces them", () => {
    render(
      <PrecheckWarnings
        warnings={[
          { code: "DESTINATION_WILL_BE_CREATED", message: "It will be created.", blocking: false },
          { code: "NO_TRUSTLINE", message: "Destination does not trust USDC.", blocking: true },
        ]}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Pre-send checks" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Recipient can't hold this asset");
    expect(items[1]).toHaveTextContent("This will create the recipient's account");
    expect(screen.getByRole("alert")).toHaveTextContent("Destination does not trust USDC.");
  });
});
