import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { PublicRoute } from "../auth/sandbox-session.guard.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { BookingWebhookService } from "./booking-webhook.service.js";

const providerEventIdPipe = new ZodValidationPipe(z.string().trim().min(1).max(120));

@Controller("webhooks/bookings")
export class BookingWebhookController {
  constructor(@Inject(BookingWebhookService) private readonly bookings: BookingWebhookService) {}

  @Post()
  @HttpCode(200)
  @PublicRoute()
  receive(
    @Body() rawBody: unknown,
    @Headers("x-booking-timestamp") timestamp?: string,
    @Headers("x-booking-signature") signature?: string,
  ) {
    return this.bookings.receiveSigned(rawBody, timestamp, signature);
  }

  @Get("events")
  list(@CurrentActor() actor: Actor) {
    return this.bookings.list(actor);
  }

  @Post("events/:id/retry")
  retry(@CurrentActor() actor: Actor, @Param("id", providerEventIdPipe) id: string) {
    return this.bookings.retry(actor, id);
  }

  @Post("demo/:conversionId/complete")
  deliverDemoCompletion(
    @CurrentActor() actor: Actor,
    @Param("conversionId", UuidValidationPipe) conversionId: string,
  ) {
    return this.bookings.deliverDemoCompletion(actor, conversionId);
  }
}
