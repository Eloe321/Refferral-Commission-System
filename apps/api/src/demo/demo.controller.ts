import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  demoSessionInput,
  resetSandboxInput,
  type DemoSessionInput,
  type ResetSandboxInput,
} from "@referral-sandbox/contracts";
import type { Actor } from "../auth/actor.js";
import { CurrentActor } from "../auth/current-actor.js";
import { SESSION_COOKIE_NAME } from "../auth/actor.js";
import { PublicRoute } from "../auth/sandbox-session.guard.js";
import { mutationIdempotencyKey } from "../common/idempotency.service.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { DemoService } from "./demo.service.js";

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
};
type StatusResponse = { status(code: number): StatusResponse };
type CookieRequest = { secure: boolean };

@Controller("demo")
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  private setCookie(
    response: CookieResponse,
    value: string,
    expiresAt: number,
    secure: boolean,
  ): void {
    response.cookie(SESSION_COOKIE_NAME, value, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: expiresAt - Date.now(),
      path: "/",
    });
  }

  @Post("session")
  @PublicRoute()
  async create(
    @Body(new ZodValidationPipe(demoSessionInput)) input: DemoSessionInput,
    @Res({ passthrough: true }) response: CookieResponse,
    @Req() request: CookieRequest,
  ) {
    const session = await this.demo.createSession(input);
    this.setCookie(response, session.value, session.expiresAt, request.secure);
    return this.demo.readSession(session.actor);
  }

  @Get("session")
  @HttpCode(200)
  get(
    @Req() request: { actor?: Actor },
    @Headers("x-sandbox-session-probe") probe: string | undefined,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const actor = request.actor;
    if (!actor) {
      if (probe === "optional") {
        response.status(204);
        return;
      }
      throw new UnauthorizedException({ status: "unauthorized" });
    }
    return this.demo.readSession(actor);
  }

  @Get("workspace")
  workspace(@CurrentActor() actor: Actor) {
    return this.demo.workspace(actor);
  }

  @Get("scenarios/:scenarioId")
  guide(@CurrentActor() actor: Actor, @Param("scenarioId") scenarioId: string) {
    return this.demo.readGuide(actor, scenarioId);
  }

  @Post("scenarios/:scenarioId/advance")
  advance(
    @CurrentActor() actor: Actor,
    @Param("scenarioId") scenarioId: string,
    @Headers("idempotency-key") key?: string,
  ) {
    const parsed = mutationIdempotencyKey.safeParse(key);
    if (!parsed.success) throw new BadRequestException({ status: "invalid_request" });
    return this.demo.advance(actor, scenarioId, parsed.data);
  }

  @Post("reset")
  async reset(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(resetSandboxInput)) input: ResetSandboxInput,
    @Res({ passthrough: true }) response: CookieResponse,
    @Req() request: CookieRequest,
  ) {
    const reset = await this.demo.reset(actor, input);
    this.setCookie(response, reset.value, reset.expiresAt, request.secure);
    return reset.response;
  }
}
