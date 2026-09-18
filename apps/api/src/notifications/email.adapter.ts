import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { AppEnv } from "../config/env.js";
import { APP_ENV } from "../database/database.module.js";
import type { DeliveryMessage } from "./sms-delivery.port.js";

export const SMTP_TRANSPORT_FACTORY = Symbol("SMTP_TRANSPORT_FACTORY");
export type SmtpTransport = {
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId: string }>;
  close(): void;
};
export type SmtpTransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
}) => SmtpTransport;
export const smtpTransportFactory: SmtpTransportFactory = (options) =>
  nodemailer.createTransport(options);
@Injectable()
export class EmailAdapter implements OnApplicationShutdown {
  private readonly transport: SmtpTransport;
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(SMTP_TRANSPORT_FACTORY) factory: SmtpTransportFactory,
  ) {
    this.transport = factory({
      host: env.SMTP_HOST ?? "mailpit",
      port: env.SMTP_PORT ?? 1025,
      secure: env.SMTP_SECURE ?? false,
    });
  }
  async send(message: DeliveryMessage): Promise<{ referenceId: string }> {
    if (this.env.EMAIL_DELIVERY_MODE === "disabled") throw new Error("Email delivery unavailable");
    try {
      const result = await this.transport.sendMail({
        from: "Referral Sandbox <no-reply@example.invalid>",
        to: message.recipient,
        subject: "Your claim verification code",
        text: message.content,
      });
      return { referenceId: result.messageId };
    } catch {
      throw new Error("Email delivery unavailable");
    }
  }
  onApplicationShutdown(): void {
    this.transport.close();
  }
}
