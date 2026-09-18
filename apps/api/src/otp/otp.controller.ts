import { Body, Controller, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  createOtpChallengeInput,
  verifyOtpInput,
  type CreateOtpChallengeInput,
} from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { UuidValidationPipe } from "../http/uuid-validation.pipe.js";
import { OtpService } from "./otp.service.js";
@Controller(["otp-challenges", "otp/challenges"])
export class OtpController {
  constructor(@Inject(OtpService) private readonly otp: OtpService) {}
  @Post() create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createOtpChallengeInput)) body: CreateOtpChallengeInput,
  ) {
    return this.otp.create(actor, body);
  }
  @Post(":id/verify") verify(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(verifyOtpInput)) body: { code: string },
  ) {
    return this.otp.verify(actor, id, body.code);
  }
  @Post(":id/resend") resend(
    @CurrentActor() actor: Actor,
    @Param("id", UuidValidationPipe) id: string,
    @Body(new ZodValidationPipe(z.strictObject({}).optional()))
    body: Record<string, never> | undefined,
  ) {
    z.strictObject({}).optional().parse(body);
    return this.otp.resend(actor, id);
  }
}
