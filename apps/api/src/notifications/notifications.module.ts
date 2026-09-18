/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from "@nestjs/common";
import { PreviewSmsAdapter } from "./preview-sms.adapter.js";
import { EmailAdapter, SMTP_TRANSPORT_FACTORY, smtpTransportFactory } from "./email.adapter.js";
import { NotificationsService } from "./notifications.service.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV } from "../database/database.module.js";
import { OutboxRepository } from "./outbox.repository.js";
import {
  OUTBOX_DELIVERY,
  OUTBOX_WORKER_OPTIONS,
  OutboxWorker,
  type OutboxDelivery,
} from "./outbox.worker.js";
import { createUniSmsAdapter, DeliveryProviderError } from "./unisms.adapter.js";
import { UnismsWebhookController } from "./unisms-webhook.controller.js";
@Module({
  controllers: [UnismsWebhookController],
  providers: [
    PreviewSmsAdapter,
    EmailAdapter,
    NotificationsService,
    OutboxRepository,
    OutboxWorker,
    { provide: SMTP_TRANSPORT_FACTORY, useValue: smtpTransportFactory },
    {
      provide: OUTBOX_DELIVERY,
      inject: [APP_ENV, EmailAdapter],
      useFactory: (env: AppEnv, email: EmailAdapter): OutboxDelivery => {
        const uniSms = createUniSmsAdapter(env);
        return {
          async send(message) {
            if (message.channel === "email") {
              const result = await email.send(message);
              return { ...result, state: "sent" };
            }
            if (message.provider === "unisms" && uniSms) return uniSms.send(message);
            throw new DeliveryProviderError("terminal");
          },
          async reconcile(provider, referenceId) {
            if (provider === "unisms" && uniSms) return uniSms.getStatus(referenceId);
            throw new DeliveryProviderError("ambiguous");
          },
        };
      },
    },
    {
      provide: OUTBOX_WORKER_OPTIONS,
      useValue: {
        batchSize: 10,
        leaseMs: 30_000,
        maxAttempts: 5,
        baseRetryMs: 1_000,
        maxRetryMs: 60_000,
        pollMs: 1_000,
      },
    },
  ],
  exports: [NotificationsService, EmailAdapter, OutboxRepository, OutboxWorker],
})
export class NotificationsModule {}
