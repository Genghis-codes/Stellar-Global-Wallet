"use client";

import { useCallback, useMemo, useState } from "react";
import { pendingSpendLimitStore, type PendingSpendLimit } from "@/lib/contract/spendLimit";

const store = pendingSpendLimitStore(() => (typeof window === "undefined" ? undefined : window.localStorage));

/**
 * Queued (24 h delayed) spend-limit increases this browser submitted for
 * `account`. The backend can't read them back, so they live in localStorage.
 */
export function usePendingSpendLimits(account: string) {
  const [version, setVersion] = useState(0);
  // `version` re-reads storage after save/remove.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => store.list(account), [account, version]);

  const save = useCallback(
    (item: PendingSpendLimit) => {
      store.save(account, item);
      setVersion((v) => v + 1);
    },
    [account],
  );

  const remove = useCallback(
    (assetCode: string) => {
      store.remove(account, assetCode);
      setVersion((v) => v + 1);
    },
    [account],
  );

  return { items, save, remove };
}
