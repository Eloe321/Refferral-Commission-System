import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../src/config/env.js";
import {
  DeliveryProviderError,
  UniSmsAdapter,
  createUniSmsAdapter,
} from "../../src/notifications/unisms.adapter.js";

const message = {
  outboxId: "11111111-1111-4111-8111-111111111111",
  recipient: "+12025550120",
  content: "Your sandbox verification code is 123456.",
  senderId: "Northstar",
  dedupeKey: "otp:challenge-1",
};

const config = {
  apiKey: "secret-key",
  senderId: "Northstar",
  endpoint: "https://unismsapi.com/api/sms",
};

describe("UniSmsAdapter", () => {
  it("sends the documented request with server-side Basic Auth and maps the nested response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: { status: "pending", reference_id: "sms-ref-1" },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = new UniSmsAdapter(config, fetchMock);

    await expect(adapter.send(message)).resolves.toEqual({
      referenceId: "sms-ref-1",
      state: "processing",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://unismsapi.com/api/sms");
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("secret-key:").toString("base64")}`,
    );
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    if (typeof request?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(request.body) as unknown).toEqual({
      recipient: message.recipient,
      content: message.content,
      sender_id: config.senderId,
      metadata: { outbox_id: message.outboxId, dedupe_key: message.dedupeKey },
    });
  });

  it.each([
    ["retrying", "processing"],
    ["sent", "sent"],
    ["failed", "failed"],
  ] as const)("maps %s to the provider-neutral %s state", async (status, state) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { status, reference_id: "sms-ref-2" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(new UniSmsAdapter(config, fetchMock).send(message)).resolves.toEqual({
      referenceId: "sms-ref-2",
      state,
    });
  });

  it.each([
    ["15550102020", "invalid recipient"],
    ["+1555 010 2020", "invalid recipient"],
    ["+123", "invalid recipient"],
    ["+".concat("1".repeat(16)), "invalid recipient"],
    ["+12025550120", "x".repeat(671)],
  ])("rejects invalid delivery data before fetch", async (recipient, content) => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new UniSmsAdapter(config, fetchMock);

    await expect(adapter.send({ ...message, recipient, content })).rejects.toThrow(
      "Invalid SMS delivery request",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, "retryable"],
    [500, "ambiguous"],
    [503, "ambiguous"],
    [400, "terminal"],
    [401, "terminal"],
    [422, "terminal"],
  ] as const)(
    "maps HTTP %i to %s without exposing private delivery data",
    async (status, disposition) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ errors: `${config.apiKey} ${message.recipient} ${message.content}` }),
            { status, headers: { "content-type": "application/json" } },
          ),
        );
      const adapter = new UniSmsAdapter(config, fetchMock);

      const error = await adapter.send(message).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DeliveryProviderError);
      expect(error).toMatchObject({ disposition });
      expect(String(error)).not.toContain(config.apiKey);
      expect(String(error)).not.toContain(message.recipient);
      expect(String(error)).not.toContain(message.content);
    },
  );

  it("treats network failures and malformed success responses as ambiguous outcomes", async () => {
    const network = new UniSmsAdapter(
      config,
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error(`leak ${config.apiKey}`)),
    );
    const malformed = new UniSmsAdapter(
      config,
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { status: "unknown" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(network.send(message)).rejects.toMatchObject({ disposition: "ambiguous" });
    await expect(malformed.send(message)).rejects.toMatchObject({ disposition: "ambiguous" });
  });

  it("requires the documented HTTP 201 success status", async () => {
    const adapter = new UniSmsAdapter(
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ message: { status: "sent", reference_id: "sms-ref-200" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    await expect(adapter.send(message)).rejects.toMatchObject({ disposition: "ambiguous" });
  });

  it.each([
    ["pending", "processing"],
    ["retrying", "processing"],
    ["sent", "sent"],
    ["failed", "failed"],
  ] as const)("polls the documented nested GET status %s as %s", async (status, state) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { status, reference_id: "sms-ref-3" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const adapter = new UniSmsAdapter(config, fetchMock);

    await expect(adapter.getStatus("sms-ref-3")).resolves.toEqual({
      referenceId: "sms-ref-3",
      state,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://unismsapi.com/api/sms/sms-ref-3",
      expect.objectContaining({ method: "GET" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("secret-key:").toString("base64")}`,
    );
  });

  it("rejects mismatched or malformed GET status responses without leaking the reference", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: { status: "sent", reference_id: "different-reference" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const error = await new UniSmsAdapter(config, fetchMock)
      .getStatus("private-reference")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect(error).toMatchObject({ disposition: "ambiguous" });
    expect(String(error)).not.toContain("private-reference");
  });

  it("does not instantiate or call UniSMS outside configured provider mode", () => {
    const fetchMock = vi.fn<typeof fetch>();
    const previewEnv = {
      SMS_DELIVERY_MODE: "preview",
      UNISMS_API_KEY: undefined,
      UNISMS_SENDER_ID: undefined,
    } as Pick<AppEnv, "SMS_DELIVERY_MODE" | "UNISMS_API_KEY" | "UNISMS_SENDER_ID">;

    expect(createUniSmsAdapter(previewEnv, fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
