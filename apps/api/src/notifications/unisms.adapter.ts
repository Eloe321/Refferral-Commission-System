import { z } from "zod";
import type { AppEnv } from "../config/env.js";

const e164 = /^\+[1-9][0-9]{7,14}$/;
const providerResponse = z.strictObject({
  message: z.object({
    status: z.enum(["pending", "retrying", "sent", "failed"]),
    reference_id: z.string().trim().min(1),
  }).loose(),
});

export type NeutralDeliveryState = "processing" | "sent" | "failed";
export type DeliveryFailureDisposition = "retryable" | "terminal" | "ambiguous";

export class DeliveryProviderError extends Error {
  constructor(readonly disposition: DeliveryFailureDisposition) {
    super("SMS provider delivery failed");
    this.name = "DeliveryProviderError";
  }
}

export type UniSmsConfig = Readonly<{
  apiKey: string;
  senderId: string;
  endpoint: string;
}>;

export type UniSmsMessage = Readonly<{
  outboxId: string;
  recipient: string;
  content: string;
  senderId?: string;
  dedupeKey?: string;
}>;

export class UniSmsAdapter {
  constructor(
    private readonly config: UniSmsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(
    message: UniSmsMessage,
  ): Promise<{ referenceId: string; state: NeutralDeliveryState }> {
    if (
      !z.uuid().safeParse(message.outboxId).success ||
      !e164.test(message.recipient) ||
      message.content.length < 1 ||
      message.content.length > 670
    ) {
      throw new Error("Invalid SMS delivery request");
    }

    let response: Response;
    try {
      response = await this.fetcher(this.config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: message.recipient,
          content: message.content,
          sender_id: this.config.senderId,
          metadata: {
            outbox_id: message.outboxId,
            ...(message.dedupeKey ? { dedupe_key: message.dedupeKey } : {}),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DeliveryProviderError("ambiguous");
    }

    if (response.status !== 201) {
      throw new DeliveryProviderError(
        response.status === 429
          ? "retryable"
          : [400, 401, 422].includes(response.status)
            ? "terminal"
            : "ambiguous",
      );
    }

    try {
      const parsed = providerResponse.parse(await response.json());
      const state: NeutralDeliveryState =
        parsed.message.status === "sent"
          ? "sent"
          : parsed.message.status === "failed"
            ? "failed"
            : "processing";
      return { referenceId: parsed.message.reference_id, state };
    } catch {
      throw new DeliveryProviderError("ambiguous");
    }
  }

  async getStatus(
    referenceId: string,
  ): Promise<{ referenceId: string; state: NeutralDeliveryState }> {
    const parsedReference = z.string().trim().min(1).max(240).safeParse(referenceId);
    if (!parsedReference.success) throw new DeliveryProviderError("ambiguous");
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.config.endpoint}/${encodeURIComponent(parsedReference.data)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString("base64")}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new DeliveryProviderError("ambiguous");
    }
    if (response.status !== 200) throw new DeliveryProviderError("ambiguous");
    try {
      const parsed = providerResponse.parse(await response.json());
      if (parsed.message.reference_id !== parsedReference.data)
        throw new DeliveryProviderError("ambiguous");
      const state: NeutralDeliveryState =
        parsed.message.status === "sent"
          ? "sent"
          : parsed.message.status === "failed"
            ? "failed"
            : "processing";
      return { referenceId: parsed.message.reference_id, state };
    } catch (error) {
      if (error instanceof DeliveryProviderError) throw error;
      throw new DeliveryProviderError("ambiguous");
    }
  }
}

export function createUniSmsAdapter(
  env: Pick<AppEnv, "SMS_DELIVERY_MODE" | "UNISMS_API_KEY" | "UNISMS_SENDER_ID">,
  fetcher: typeof fetch = fetch,
): UniSmsAdapter | null {
  if (
    env.SMS_DELIVERY_MODE !== "unisms" ||
    !env.UNISMS_API_KEY ||
    env.UNISMS_API_KEY === "replace_me" ||
    !env.UNISMS_SENDER_ID ||
    env.UNISMS_SENDER_ID === "replace_me"
  ) {
    return null;
  }
  return new UniSmsAdapter(
    {
      apiKey: env.UNISMS_API_KEY,
      senderId: env.UNISMS_SENDER_ID,
      endpoint: "https://unismsapi.com/api/sms",
    },
    fetcher,
  );
}
