import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { actorRoles, type ActorRole } from "@referral-sandbox/contracts";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { APP_ENV, DATABASE_CLIENT } from "../database/database.module.js";
import { NORTHSTAR_IDS, type DatabaseClient } from "@referral-sandbox/database";
import { SESSION_COOKIE_NAME, type Actor } from "./actor.js";

export const IS_PUBLIC_ROUTE = "isPublicRoute";
export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);

const MAX_COOKIE_LENGTH = 2048;
const sessionPayloadSchema = z.strictObject({
  actorId: z.uuid(),
  organizationId: z.uuid(),
  role: z.enum(actorRoles),
  sandboxVersion: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;
type ActorRequest = {
  cookies?: Record<string, unknown>;
  actor?: Actor;
  headers?: Record<string, unknown>;
  url?: string;
};

function encode(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Creates an HMAC-authenticated, compact browser session value. */
export function createSessionCookie(payload: SessionPayload, secret: string): string {
  const encodedPayload = encode(payload);
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function parseSessionCookie(value: unknown, secret: string): SessionPayload | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_COOKIE_LENGTH) {
    return undefined;
  }
  const [encodedPayload, signature, ...extra] = value.split(".");
  if (
    !encodedPayload ||
    !signature ||
    extra.length !== 0 ||
    !safeEqual(sign(encodedPayload, secret), signature)
  ) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    const result = sessionPayloadSchema.safeParse(parsed);
    return result.success && result.data.expiresAt > Date.now() ? result.data : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class SandboxSessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const requestPath = request.url?.split("?", 1)[0];
    if (
      this.env.APP_MODE !== "sandbox" &&
      (requestPath === "/demo" || requestPath?.startsWith("/demo/"))
    ) {
      throw new NotFoundException();
    }
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const optionalSessionProbe =
      requestPath === "/demo/session" &&
      request.headers?.["x-sandbox-session-probe"] === "optional";
    const payload = parseSessionCookie(
      request.cookies?.[SESSION_COOKIE_NAME],
      this.env.SESSION_SECRET,
    );
    if (!payload) {
      if (optionalSessionProbe) return true;
      throw new UnauthorizedException({ status: "unauthorized" });
    }

    const actor = await this.findEligibleActor(payload.actorId);
    if (
      !actor ||
      actor.organizationId !== payload.organizationId ||
      actor.role !== payload.role ||
      actor.sandboxVersion !== payload.sandboxVersion
    ) {
      if (optionalSessionProbe) return true;
      throw new UnauthorizedException({ status: "unauthorized" });
    }
    request.actor = actor;
    return true;
  }

  async findEligibleActor(actorId: string): Promise<Actor | undefined> {
    const rows = await this.database.sql<
      {
        actorId: string;
        organizationId: string;
        role: ActorRole;
        partnerId: string | null;
        displayName: string;
        partnerStatus: string | null;
        sandboxVersion: number;
      }[]
    >`select u.id as "actorId", u.organization_id as "organizationId", u.role, p.id as "partnerId", u.display_name as "displayName", p.status as "partnerStatus",o.sandbox_version as "sandboxVersion"
      from users u
      join organizations o on o.id=u.organization_id
      left join partners p on p.organization_id = u.organization_id and p.user_id = u.id
      where u.id = ${actorId}`;
    const actor = rows[0];
    if (!actor || actor.organizationId !== NORTHSTAR_IDS.organization) return undefined;
    if (
      !actorRoles.includes(actor.role) ||
      (actor.role === "partner" && (actor.partnerId === null || actor.partnerStatus !== "active"))
    ) {
      return undefined;
    }
    return Object.freeze({
      actorId: actor.actorId,
      organizationId: actor.organizationId,
      role: actor.role,
      partnerId: actor.partnerId,
      displayName: actor.displayName,
      sandboxVersion: actor.sandboxVersion,
    });
  }
}
