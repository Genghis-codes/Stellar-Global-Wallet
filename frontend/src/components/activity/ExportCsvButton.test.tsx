import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import * as exportLib from "@/lib/activity/export";
import { renderWithProviders } from "@/test/render";
import { ExportCsvButton } from "./ExportCsvButton";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

beforeEach(() => vi.restoreAllMocks());

describe("ExportCsvButton", () => {
  it("downloads the statement for the chosen range", async () => {
    const exportCsv = vi.spyOn(api.account, "exportCsv").mockResolvedValue("date,hash\n");
    const download = vi.spyOn(exportLib, "downloadTextFile").mockImplementation(() => {});
    const user = userEvent.setup();
    renderWithProviders(<ExportCsvButton account={G} />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });
    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(await screen.findByText("Statement downloaded")).toBeInTheDocument();
    expect(exportCsv).toHaveBeenCalledWith(G, exportLib.exportRangeQuery("2026-01-01", "2026-01-31"));
    expect(download).toHaveBeenCalledWith(exportLib.exportFileName(G, "2026-01-01", "2026-01-31"), "date,hash\n");
  });

  it("blocks ranges over a year", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportCsvButton account={G} />);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("at most one year");
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  });
});
