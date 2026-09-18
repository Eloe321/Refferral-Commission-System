import { Inject, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { reasonInput, type ReasonInput } from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { EarningsService } from "./earnings.service.js";
@Controller("earnings")
export class EarningsController {
  constructor(@Inject(EarningsService) private readonly earnings: EarningsService) {}
  @Get() list(
    @CurrentActor() a: Actor,
    @Query(new ZodValidationPipe(z.strictObject({ conversionId: z.uuid().optional() })))
    query: { conversionId?: string },
  ) {
    return this.earnings.list(a, query.conversionId);
  }
  @Post(":id/hold") hold(
    @CurrentActor() a: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) b: ReasonInput,
  ) {
    return this.earnings.hold(a, id, b.reason);
  }
  @Post(":id/release") release(
    @CurrentActor() a: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) b: ReasonInput,
  ) {
    return this.earnings.release(a, id, b.reason);
  }
  @Post(":id/void") void(
    @CurrentActor() a: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) b: ReasonInput,
  ) {
    return this.earnings.void(a, id, b.reason);
  }
}
