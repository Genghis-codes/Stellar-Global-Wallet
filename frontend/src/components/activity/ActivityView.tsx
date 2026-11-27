"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { useCurrentAccount } from "@/hooks/useAccount";
import { filtersFromSearchParams, filtersToSearchParams, type ActivityFilters } from "@/lib/activity/filters";
import { PaymentsFeed } from "./PaymentsFeed";
import { TransactionsFeed } from "./TransactionsFeed";
import { UnifiedFeed } from "./UnifiedFeed";

export function ActivityView() {
  const account = useCurrentAccount();
  const router = useRouter();
  const pathname = usePathname() ?? "/activity";
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString());
  const filters = filtersFromSearchParams(params);

  const items: TabItem[] = [
    { id: "payments", label: "Payments", content: <PaymentsFeed account={account} filters={filters} onFiltersChange={setFilters} /> },
    { id: "transactions", label: "Transactions", content: <TransactionsFeed account={account} /> },
    { id: "all", label: "All activity", content: <UnifiedFeed account={account} /> },
  ];
  const requested = params.get("tab");
  const tab = items.some((item) => item.id === requested) ? requested! : items[0]!.id;

  function navigate(next: URLSearchParams) {
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function setFilters(next: ActivityFilters) {
    const query = filtersToSearchParams(next);
    if (tab !== "payments") query.set("tab", tab);
    navigate(query);
  }

  function selectTab(id: string) {
    // Filters only apply to payments; switching tabs keeps them for when the user comes back.
    const next = new URLSearchParams(params);
    if (id === "payments") next.delete("tab");
    else next.set("tab", id);
    navigate(next);
  }

  return (
    <>
      <PageHeader title="Activity" description="Payments and transactions on your account, newest first." />
      <Card>
        <CardBody>
          <Tabs items={items} value={tab} onChange={selectTab} aria-label="Activity views" />
        </CardBody>
      </Card>
    </>
  );
}
