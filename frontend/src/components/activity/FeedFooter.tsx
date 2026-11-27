"use client";

import { Button } from "@/components/ui/Button";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

export interface FeedFooterProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Shown when the whole history has been loaded. */
  endLabel?: string;
}

/** Infinite-scroll sentinel plus a "Load more" fallback under a cursor-paged list. */
export function FeedFooter({ hasMore, loading, onLoadMore, endLabel = "You've reached the beginning of your history." }: FeedFooterProps) {
  const sentinel = useInfiniteScroll({ hasMore, loading, onLoadMore });
  return (
    <div ref={sentinel} className="flex justify-center py-4">
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loading} onClick={onLoadMore}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : (
        <p className="text-sm text-fg-muted">{endLabel}</p>
      )}
    </div>
  );
}
