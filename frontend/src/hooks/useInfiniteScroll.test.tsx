import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useInfiniteScroll } from "./useInfiniteScroll";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
const observers: Array<{ callback: Callback; disconnect: ReturnType<typeof vi.fn> }> = [];

class FakeObserver {
  disconnect = vi.fn();
  constructor(public callback: Callback) {
    observers.push(this);
  }
  observe() {}
}

function List(props: { hasMore: boolean; loading: boolean; onLoadMore: () => void }) {
  const ref = useInfiniteScroll(props);
  return <div ref={ref} />;
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("useInfiniteScroll", () => {
  it("loads more when the sentinel becomes visible", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const onLoadMore = vi.fn();
    render(<List hasMore loading={false} onLoadMore={onLoadMore} />);
    observers[0]!.callback([{ isIntersecting: false }]);
    expect(onLoadMore).not.toHaveBeenCalled();
    observers[0]!.callback([{ isIntersecting: true }]);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not observe while loading or at the end", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { rerender } = render(<List hasMore loading onLoadMore={vi.fn()} />);
    expect(observers).toHaveLength(0);
    rerender(<List hasMore={false} loading={false} onLoadMore={vi.fn()} />);
    expect(observers).toHaveLength(0);
  });
});
