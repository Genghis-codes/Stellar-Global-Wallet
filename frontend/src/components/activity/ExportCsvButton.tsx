"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api/errors";
import {
  defaultExportRange,
  downloadTextFile,
  exportFileName,
  exportRangeQuery,
  toDayString,
  validateExportRange,
} from "@/lib/activity/export";

/** "Export CSV" action: pick a date range (max one year) and download the statement. */
export function ExportCsvButton({ account }: { account: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(defaultExportRange);
  const invalid = validateExportRange(range.from, range.to);

  const exportCsv = useMutation({
    mutationFn: () => api.account.exportCsv(account, exportRangeQuery(range.from, range.to)),
    onSuccess: (csv) => {
      downloadTextFile(exportFileName(account, range.from, range.to), csv);
      setOpen(false);
      toast.show({ id: "csv-export", title: "Statement downloaded", tone: "success" });
    },
    onError: (error) => toast.show({ id: "csv-export", title: "Export failed", description: describeError(error), tone: "danger" }),
  });

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Export CSV
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!exportCsv.isPending}
        title="Export statement"
        description="Download your transactions as a CSV file for accounting or taxes. Up to one year at a time."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={exportCsv.isPending}>
              Cancel
            </Button>
            <Button onClick={() => exportCsv.mutate()} disabled={Boolean(invalid)} loading={exportCsv.isPending}>
              Download CSV
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="From"
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <Input
            label="To"
            type="date"
            value={range.to}
            min={range.from}
            max={toDayString(new Date())}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
        {invalid && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {invalid}
          </p>
        )}
      </Modal>
    </>
  );
}
