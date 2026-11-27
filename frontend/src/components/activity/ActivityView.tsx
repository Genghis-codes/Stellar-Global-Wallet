"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { useCurrentAccount } from "@/hooks/useAccount";
import { filtersFromSearchParams, filtersToSearchParams, type ActivityFilters } from "@/lib/activity/filters";
import { PaymentsFeed } from "./PaymentsFeed";

export function ActivityView() {
  const account = useCurrentAccount();
  const router = useRouter();
  const pathname = usePathname() ?? "/activity";
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString());
  const filters = filtersFromSearchParams(params);

  function setFilters(next: ActivityFilters) {
    const query = filtersToSearchParams(next).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader title="Activity" description="Payments and transactions on your account, newest first." />
      <Card>
        <CardBody>
          <PaymentsFeed account={account} filters={filters} onFiltersChange={setFilters} />
        </CardBody>
      </Card>
    </>
  );
}
