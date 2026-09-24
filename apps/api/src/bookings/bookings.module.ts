/* eslint-disable @typescript-eslint/no-extraneous-class -- Nest module token classes are required. */
import { Module } from "@nestjs/common";
import { BookingWebhookController } from "./booking-webhook.controller.js";
import { BookingWebhookService } from "./booking-webhook.service.js";

@Module({ controllers: [BookingWebhookController], providers: [BookingWebhookService] })
export class BookingsModule {}
