import {
  Inject,
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import {
  createConversionInput,
  refundInput,
  reasonInput,
  type CreateConversionInput,
  type RefundInput,
  type ReasonInput,
} from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { ConversionsService } from "./conversions.service.js";
import { ReversalService } from "../claims/reversal.service.js";
import { mutationIdempotencyKey } from "../common/idempotency.service.js";
@Controller("conversions")
export class ConversionsController {
  constructor(
    @Inject(ConversionsService) private readonly conversions: ConversionsService,
    @Inject(ReversalService) private readonly reversals: ReversalService,
  ) {}
  @Post() create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createConversionInput)) body: CreateConversionInput,
  ) {
    return this.conversions.create(actor, body);
  }
  @Post(":id/complete") complete(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Headers("idempotency-key") key?: string,
  ) {
    if (!key || key.trim().length < 8 || key.length > 120)
      throw new BadRequestException({ status: "invalid_request" });
    return this.conversions.complete(actor, id, key);
  }
  @Post(":id/cancel") cancel(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.conversions.cancel(actor, id, "cancelled", body.reason);
  }
  @Post(":id/no-show") noShow(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.conversions.cancel(actor, id, "no_show", body.reason);
  }
  @Post(":id/refund") refund(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(refundInput)) body: RefundInput,
    @Headers("idempotency-key") key?: string,
  ) {
    const parsedKey = mutationIdempotencyKey.safeParse(key);
    if (!parsedKey.success) throw new BadRequestException({ status: "invalid_request" });
    return this.reversals.refund(actor, id, body, parsedKey.data);
  }
}
