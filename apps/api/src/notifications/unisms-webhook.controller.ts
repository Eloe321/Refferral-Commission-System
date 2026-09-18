import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PublicRoute } from "../auth/sandbox-session.guard.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV } from "../database/database.module.js";
import { OutboxRepository } from "./outbox.repository.js";

const identifier = z.string().trim().min(1).max(240);
const webhookPayload = z.strictObject({
  id: identifier,
  event: z.enum(["message.sent", "message.failed", "message.retrying"]),
  message: z
    .object({
      status: z.enum(["sent", "failed", "retrying"]),
      reference_id: identifier,
      metadata: z
        .object({ outbox_id: z.uuid() })
        .loose()
        .optional(),
    })
    .loose(),
});

function safeSecretEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

@Controller("webhooks/unisms")
@PublicRoute()
export class UnismsWebhookController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers("webhook-secret-key") suppliedSecret: string | undefined,
    @Headers("webhook-id") webhookId: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: "processed" | "duplicate" | "ignored" }> {
    const expectedSecret = this.env.UNISMS_WEBHOOK_SECRET;
    if (
      !expectedSecret ||
      !suppliedSecret ||
      !safeSecretEqual(suppliedSecret, expectedSecret)
    ) {
      throw new UnauthorizedException({ status: "unauthorized" });
    }
    const parsedWebhookId = identifier.safeParse(webhookId);
    if (!parsedWebhookId.success) {
      throw new BadRequestException({ status: "invalid_request" });
    }
    const parsed = webhookPayload.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ status: "invalid_request" });
    const expectedStatus = parsed.data.event.slice("message.".length);
    if (
      parsed.data.id !== parsed.data.message.reference_id ||
      parsed.data.message.status !== expectedStatus
    ) {
      throw new BadRequestException({ status: "invalid_request" });
    }
    const result = await this.outbox.applyWebhook({
      provider: "unisms",
      providerEventId: parsedWebhookId.data,
      providerReference: parsed.data.message.reference_id,
      ...(parsed.data.message.metadata
        ? { outboxId: parsed.data.message.metadata.outbox_id }
        : {}),
      eventType: parsed.data.event,
    });
    return { status: result === "not_found" ? "ignored" : result };
  }
}
