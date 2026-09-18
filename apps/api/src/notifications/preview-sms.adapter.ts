import { Inject, Injectable } from "@nestjs/common";
import type { ChallengeDelivery } from "@referral-sandbox/contracts";
import type { AppEnv } from "../config/env.js";
import { APP_ENV } from "../database/database.module.js";
import { maskRecipient } from "./sms-delivery.port.js";

@Injectable()
export class PreviewSmsAdapter {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}
  preview(input: { recipient: string; code: string; expiresAt: Date }): ChallengeDelivery {
    if (this.env.APP_MODE !== "sandbox" || this.env.SMS_DELIVERY_MODE !== "preview")
      return { mode: "disabled", status: "unavailable" };
    return {
      mode: "preview",
      preview: {
        recipientMasked: maskRecipient(input.recipient, "sms"),
        message: otpMessage(input.code),
        code: input.code,
        expiresAt: input.expiresAt.toISOString(),
      },
    };
  }
}
export const otpMessage = (code: string) =>
  `Your referral claim verification code is ${code}. It expires in 5 minutes. Do not share this code.`;
