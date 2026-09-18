import { Body, Controller, Get, Headers, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  createClaimInput,
  simulateClaimInput,
  type CreateClaimInput,
} from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { ClaimsService } from "./claims.service.js";
const emptySimulationBody = z.strictObject({}).optional();

@Controller("claims")
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}
  @Post() create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createClaimInput)) body: CreateClaimInput,
    @Headers("idempotency-key") key: string,
  ) {
    return this.claims.create(actor, body, key);
  }
  @Get() list(@CurrentActor() actor: Actor) {
    return this.claims.list(actor);
  }
  @Get(":id") get(@CurrentActor() actor: Actor, @Param("id", UuidValidationPipe) id: string) {
    return this.claims.get(actor, id);
  }
  @Post(":id/simulate") simulate(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(simulateClaimInput)) body: { outcome: "success" | "failure" },
  ) {
    return this.claims.simulate(actor, id, body.outcome);
  }
  @Post(":id/retry") retry(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodValidationPipe(emptySimulationBody)) body: Record<string, never> | undefined,
  ) {
    emptySimulationBody.parse(body);
    return this.claims.retry(actor, id, key);
  }
  @Post(":claimId/simulate-success") simulateSuccess(
    @CurrentActor() actor: Actor,
    @Param("claimId", UuidValidationPipe) claimId: string,
    @Body(new ZodValidationPipe(emptySimulationBody)) body: Record<string, never> | undefined,
  ) {
    emptySimulationBody.parse(body);
    return this.claims.simulate(actor, claimId, "success");
  }
  @Post(":claimId/simulate-failure") simulateFailure(
    @CurrentActor() actor: Actor,
    @Param("claimId", UuidValidationPipe) claimId: string,
    @Body(new ZodValidationPipe(emptySimulationBody)) body: Record<string, never> | undefined,
  ) {
    emptySimulationBody.parse(body);
    return this.claims.simulate(actor, claimId, "failure");
  }
}
