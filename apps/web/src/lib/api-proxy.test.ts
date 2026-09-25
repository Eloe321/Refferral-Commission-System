import { describe, expect, it, vi } from "vitest";

import { proxyApiRequest } from "./api-proxy.js";

describe("proxyApiRequest", () => {
  it("forwards the API path, query, request body, and session cookie", async () => {
    const upstream = new Response('{"status":"ok"}', { status: 201 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(upstream);
    const request = new Request("https://referral-commission-system.pages.dev/api/demo/session?reset=true", {
      method: "POST",
      headers: {
        cookie: "sandbox_session=signed-value",
        "content-type": "application/json",
      },
      body: '{"role":"owner"}',
    });

    const response = await proxyApiRequest(
      request,
      ["demo", "session"],
      "https://refferral-commission-system-production.up.railway.app",
      fetcher,
    );

    expect(response).toBe(upstream);
    expect(fetcher).toHaveBeenCalledOnce();
    const forwarded = fetcher.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(
      "https://refferral-commission-system-production.up.railway.app/demo/session?reset=true",
    );
    expect(forwarded.headers.get("cookie")).toBe("sandbox_session=signed-value");
    expect(forwarded.headers.get("content-type")).toBe("application/json");
    await expect(forwarded.text()).resolves.toBe('{"role":"owner"}');
  });
});
