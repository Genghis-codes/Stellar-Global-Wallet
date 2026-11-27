"use client";

import { useEffect, useRef } from "react";

export interface InfiniteScrollOptions {
  /** Whether there is another page to load. */
  hasMore: boolean;
  /** Skip triggering while a page is already loading. */
  loading: boolean;
  onLoadMore: () => void;
  /** Start loading this far before the sentinel is visible. */
  rootMargin?: string;
}

/**
 * Returns a ref for a sentinel element placed after a list. When the
 * sentinel scrolls into view, `onLoadMore` is called. Without
 * IntersectionObserver (old browsers, tests) nothing happens, so lists
 * should also render a "Load more" button.
 */
export function useInfiniteScroll<T extends Element = HTMLDivElement>({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = "200px",
}: InfiniteScrollOptions) {
  const ref = useRef<T | null>(null);
  const callback = useRef(onLoadMore);

  useEffect(() => {
    callback.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, rootMargin]);

  return ref;
}
