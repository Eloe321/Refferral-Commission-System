import { Inject, Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  commissionRuleInput,
  createProgramInput,
  createReferralCodeInput,
  previewCommissionInput,
  reasonInput,
  type CommissionRuleInput,
  type CreateProgramInput,
  type CreateReferralCodeInput,
  type PreviewCommissionInput,
  type ReasonInput,
} from "@referral-sandbox/contracts";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { ProgramsService } from "./programs.service.js";

const programIdPipe = new ZodValidationPipe(z.uuid());

@Controller("programs")
export class ProgramsController {
  constructor(@Inject(ProgramsService) private readonly programs: ProgramsService) {}
  @Get() list(@CurrentActor() actor: Actor) {
    return this.programs.list(actor);
  }
  @Post() createProgram(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createProgramInput)) body: CreateProgramInput,
  ) {
    return this.programs.createProgram(actor, body);
  }
  @Get(":id/codes") codes(@CurrentActor() actor: Actor, @Param("id", programIdPipe) id: string) {
    return this.programs.codes(actor, id);
  }
  @Post(":id/codes") createCode(
    @CurrentActor() actor: Actor,
    @Param("id", programIdPipe) id: string,
    @Body(new ZodValidationPipe(createReferralCodeInput)) body: CreateReferralCodeInput,
  ) {
    return this.programs.createCode(actor, id, body);
  }
  @Post(":id/preview") preview(
    @CurrentActor() actor: Actor,
    @Param("id", programIdPipe) id: string,
    @Body(new ZodValidationPipe(previewCommissionInput)) body: PreviewCommissionInput,
  ) {
    return this.programs.preview(actor, id, body);
  }
  @Get(":id/rules") rules(@CurrentActor() actor: Actor, @Param("id", programIdPipe) id: string) {
    return this.programs.rules(actor, id);
  }
  @Post(":id/rules") create(
    @CurrentActor() actor: Actor,
    @Param("id", programIdPipe) id: string,
    @Body(new ZodValidationPipe(commissionRuleInput)) body: CommissionRuleInput,
  ) {
    return this.programs.createRule(actor, id, body);
  }
  @Post(":id/pause") pause(
    @CurrentActor() actor: Actor,
    @Param("id", programIdPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.programs.state(actor, id, "paused", body.reason);
  }
  @Post(":id/resume") resume(
    @CurrentActor() actor: Actor,
    @Param("id", programIdPipe) id: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ) {
    return this.programs.state(actor, id, "active", body.reason);
  }
}
