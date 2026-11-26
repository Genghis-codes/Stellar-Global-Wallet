import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { devApi } from "./dev";

describe("devApi", () => {
  it("posts the account to the Friendbot route", async () => {
    const fetch = mockFetch(jsonResponse({ account: "GA", funded: true, alreadyFunded: true }));
    const dev = devApi(createApiClient({ baseUrl: "http://api.test", fetch }));
    await expect(dev.fund("GA")).resolves.toMatchObject({ alreadyFunded: true });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/dev/fund");
    expect(fetch.mock.calls[0]![1]?.body).toBe('{"account":"GA"}');
  });
});
