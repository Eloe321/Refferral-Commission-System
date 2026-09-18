import { Inject, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { reasonInput, type ReasonInput } from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { PartnersService } from "./partners.service.js";
@Controller("partners")
export class PartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}
  @Get() list(@CurrentActor() actor: Actor) {
    return this.partners.list(actor);
  }
  @Get(":id") one(@CurrentActor() actor: Actor, @Param("id", UuidValidationPipe) id: string) {
    return this.partners.one(actor, id);
  }
  @Post(":id/suspend") suspend(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.partners.state(actor, id, "suspended", body.reason);
  }
  @Post(":id/reactivate") reactivate(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.partners.state(actor, id, "active", body.reason);
  }
}
