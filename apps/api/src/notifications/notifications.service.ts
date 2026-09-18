import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { ChallengeDelivery } from "@referral-sandbox/contracts";
import type { TransactionSql } from "postgres";
import type { AppEnv } from "../config/env.js";
import { APP_ENV } from "../database/database.module.js";
import { PreviewSmsAdapter, otpMessage } from "./preview-sms.adapter.js";
import { maskRecipient } from "./sms-delivery.port.js";

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PreviewSmsAdapter) private readonly preview: PreviewSmsAdapter,
  ) {}
  assertAvailable(channel: "sms" | "email"): void {
    if (
      channel === "sms"
        ? this.env.SMS_DELIVERY_MODE === "disabled" ||
          (this.env.SMS_DELIVERY_MODE === "preview" && this.env.APP_MODE !== "sandbox")
        : this.env.EMAIL_DELIVERY_MODE === "disabled"
    )
      throw new ServiceUnavailableException({
        status: "channel_unavailable",
        delivery: { mode: "disabled", status: "unavailable" },
      });
  }
  async queue(
    sql: TransactionSql,
    input: {
      organizationId: string;
      challengeId: string;
      generation: string;
      channel: "sms" | "email";
      recipient: string;
      code: string;
      expiresAt: Date;
    },
  ): Promise<ChallengeDelivery> {
    this.assertAvailable(input.channel);
    const delivery: ChallengeDelivery =
      input.channel === "sms" && this.env.SMS_DELIVERY_MODE === "preview"
        ? this.preview.preview(input)
        : { mode: "provider", status: "queued" };
    const preview = delivery.mode === "preview";
    const provider =
      input.channel === "email" ? this.env.EMAIL_DELIVERY_MODE : this.env.SMS_DELIVERY_MODE;
    await sql`insert into notification_outbox (organization_id,dedupe_key,channel,provider,status,recipient,content,otp_challenge_id)
      values (${input.organizationId},${`otp:${input.challengeId}:${input.generation}`},${input.channel},${provider},${preview ? "previewed" : "pending"},${preview ? maskRecipient(input.recipient, input.channel) : input.recipient},${preview ? null : otpMessage(input.code)},${input.challengeId})`;
    return delivery;
  }
}
