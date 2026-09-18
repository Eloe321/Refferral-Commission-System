import {
  claimSchema,
  claimListSchema,
  challengeDeliverySchema,
  conversionSchema,
  createClaimInput,
  createOtpChallengeInput,
  demoSessionInput,
  demoSessionSchema,
  demoScenarioId,
  demoWorkspaceSchema,
  guideStateSchema,
  resetSandboxInput,
  resetSandboxResponseSchema,
  earningListSchema,
  earningViewSchema,
  ownerClaimListSchema,
  ownerClaimSchema,
  partnerDetailSchema,
  partnerSchema,
  programSchema,
  refundInput,
  otpChallengeResponseSchema,
  otpChallengeStateSchema,
  reasonInput,
  verifyOtpInput,
  type ActorRole,
  type Claim,
  type Conversion,
  type DemoSession,
  type EarningView,
  type OwnerClaim,
  type PartnerDetail,
  type Program,
  type ChallengeDelivery,
  type DemoWorkspace,
  type GuideState,
  type ResetSandboxResponse,
} from "@referral-sandbox/contracts";
import { z, type ZodType } from "zod";

export type SessionActor = DemoSession;

export type OwnerOverview = {
  programs: Program[];
  earnings: EarningView[];
  partners: PartnerDetail[];
  claims: OwnerClaim[];
};

export type PartnerOverview = {
  partner: PartnerDetail;
  earnings: EarningView[];
  claims: Claim[];
};

export type ApiErrorDetails = {
  attemptsRemaining?: number;
  resendAfter?: string;
  delivery?: ChallengeDelivery;
};

export type ServerClock = {
  serverNowMs: number;
  receivedAtClientMs: number;
};

export type OtpChallengeWithClock = z.infer<typeof otpChallengeResponseSchema> & ServerClock;

const demoActors: Record<ActorRole, string> = {
  owner: "11111111-1111-4111-8111-000000000002",
  partner: "11111111-1111-4111-8111-000000000003",
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetails = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function endpoint(path: string): string {
  if (typeof window === "undefined") {
    throw new Error("The sandbox API client is browser-only");
  }
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const base = configured
    ? `${configured.replace(/\/$/, "")}/`
    : `${window.location.origin.replace(/\/$/, "")}/api/`;
  return new URL(path.replace(/^\//, ""), base).toString();
}

async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
  observeResponse?: (response: Response) => void,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(endpoint(path), {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    let status = `request_failed_${String(response.status)}`;
    let details: ApiErrorDetails = {};
    try {
      const payload = z
        .object({
          status: z.string(),
          attemptsRemaining: z.number().int().nonnegative().optional(),
          resendAfter: z.iso.datetime().optional(),
          delivery: challengeDeliverySchema.optional(),
        })
        .safeParse(await response.json());
      if (payload.success) {
        status = payload.data.status;
        details = {
          ...(payload.data.attemptsRemaining === undefined
            ? {}
            : { attemptsRemaining: payload.data.attemptsRemaining }),
          ...(payload.data.resendAfter === undefined
            ? {}
            : { resendAfter: payload.data.resendAfter }),
          ...(payload.data.delivery === undefined ? {} : { delivery: payload.data.delivery }),
        };
      }
    } catch {
      // The HTTP status remains authoritative when an upstream body is not JSON.
    }
    throw new ApiError(status, response.status, details);
  }
  observeResponse?.(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new TypeError(`API response did not match ${path} contract`);
  return parsed.data;
}

function responseClock(response: Response): ServerClock {
  const receivedAtClientMs = Date.now();
  const headerTime = Date.parse(response.headers.get("Date") ?? "");
  return {
    serverNowMs: Number.isFinite(headerTime) ? headerTime : receivedAtClientMs,
    receivedAtClientMs,
  };
}

async function requestOtpChallenge(
  path: string,
  init: RequestInit,
): Promise<OtpChallengeWithClock> {
  let clock: ServerClock | undefined;
  const challenge = await requestJson(path, otpChallengeResponseSchema, init, (response) => {
    clock = responseClock(response);
  });
  const clientNow = Date.now();
  return {
    ...challenge,
    ...(clock ?? { serverNowMs: clientNow, receivedAtClientMs: clientNow }),
  };
}

function mutationHeaders(): HeadersInit {
  return { "Idempotency-Key": crypto.randomUUID() };
}

export async function readDemoSession(): Promise<SessionActor> {
  return requestJson("/demo/session", demoSessionSchema);
}

export async function probeDemoSession(): Promise<SessionActor | null> {
  const response = await fetch(endpoint("/demo/session"), {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-Sandbox-Session-Probe": "optional",
    },
  });
  if (response.status === 204 || response.status === 401) return null;
  if (!response.ok) throw new ApiError(`request_failed_${String(response.status)}`, response.status);
  const parsed = demoSessionSchema.safeParse(await response.json());
  if (!parsed.success) throw new TypeError("API response did not match /demo/session contract");
  return parsed.data;
}

export async function createDemoSession(role: ActorRole): Promise<SessionActor> {
  const input = demoSessionInput.parse({ role, actorId: demoActors[role] });
  return requestJson("/demo/session", demoSessionSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDemoWorkspace(): Promise<DemoWorkspace> {
  return requestJson("/demo/workspace", demoWorkspaceSchema);
}

export async function getGuideState(): Promise<GuideState> {
  return requestJson(`/demo/scenarios/${demoScenarioId}`, guideStateSchema);
}

export async function advanceGuide(): Promise<GuideState> {
  return requestJson(`/demo/scenarios/${demoScenarioId}/advance`, guideStateSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({}),
  });
}

export async function resetDemoSandbox(): Promise<ResetSandboxResponse> {
  const input = resetSandboxInput.parse({ confirmation: "RESET SANDBOX" });
  return requestJson("/demo/reset", resetSandboxResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loadOrCreateDemoSession(role: ActorRole = "owner"): Promise<SessionActor> {
  return (await probeDemoSession()) ?? createDemoSession(role);
}

export async function getEligibleEarnings(): Promise<z.infer<typeof earningListSchema>> {
  return requestJson("/earnings", earningListSchema);
}

export async function getPartnerOverview(partnerId: string): Promise<PartnerOverview> {
  const [partner, earnings, claims] = await Promise.all([
    requestJson(`/partners/${partnerId}`, partnerDetailSchema),
    requestJson("/earnings", earningListSchema),
    requestJson("/claims", claimListSchema),
  ]);
  return { partner, earnings: earnings.items, claims: claims.items };
}

export async function placeEarningHold(id: string, reason: string): Promise<EarningView> {
  const input = reasonInput.parse({ reason });
  return requestJson(`/earnings/${id}/hold`, earningViewSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export async function getOwnerOverview(): Promise<OwnerOverview> {
  const [programs, earnings, partnerSummaries, claims] = await Promise.all([
    requestJson("/programs", z.array(programSchema)),
    requestJson("/earnings", earningListSchema),
    requestJson("/partners", z.array(partnerSchema)),
    requestJson("/claims", ownerClaimListSchema),
  ]);
  const partners = await Promise.all(
    partnerSummaries.map((partner) => requestJson(`/partners/${partner.id}`, partnerDetailSchema)),
  );
  return { programs, earnings: earnings.items, partners, claims: claims.items };
}

export async function changeEarningState(
  id: string,
  action: "hold" | "release" | "void",
  reason: string,
): Promise<EarningView> {
  const input = reasonInput.parse({ reason });
  return requestJson(`/earnings/${id}/${action}`, earningViewSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export async function changeProgramState(
  id: string,
  action: "pause" | "resume",
  reason: string,
): Promise<Program> {
  const input = reasonInput.parse({ reason });
  return requestJson(`/programs/${id}/${action}`, programSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export async function changePartnerState(
  id: string,
  action: "suspend" | "reactivate",
  reason: string,
): Promise<PartnerDetail> {
  const input = reasonInput.parse({ reason });
  return requestJson(`/partners/${id}/${action}`, partnerDetailSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export async function changeConversionState(
  conversion: Conversion,
  action: "complete" | "cancel" | "no-show" | "refund",
  reason?: string,
  refundItems?: { conversionItemId: string; refundedBaseMinor: string }[],
): Promise<Conversion> {
  const body =
    action === "complete"
      ? undefined
      : action === "refund"
        ? refundInput.parse({
            reason,
            items: refundItems,
          })
        : reasonInput.parse({ reason });
  return requestJson(`/conversions/${conversion.id}/${action}`, conversionSchema, {
    method: "POST",
    headers: mutationHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export async function simulateClaim(id: string, outcome: "success" | "failure"): Promise<Claim> {
  return requestJson(`/claims/${id}/simulate-${outcome}`, ownerClaimSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({}),
  });
}

export async function retryClaim(id: string): Promise<OwnerClaim> {
  return requestJson(`/claims/${id}/retry`, ownerClaimSchema, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({}),
  });
}

export async function createOtpChallenge(
  earningIds: string[],
  channel: "sms" | "email",
): Promise<OtpChallengeWithClock> {
  const input = createOtpChallengeInput.parse({ earningIds, channel });
  return requestOtpChallenge("/otp-challenges", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createPreviewChallenge(earningIds: string[]) {
  return createOtpChallenge(earningIds, "sms");
}

export async function verifyOtpChallenge(
  challengeId: string,
  code: string,
): Promise<z.infer<typeof otpChallengeStateSchema>> {
  const input = verifyOtpInput.parse({ code });
  return requestJson(`/otp-challenges/${challengeId}/verify`, otpChallengeStateSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resendOtpChallenge(challengeId: string): Promise<OtpChallengeWithClock> {
  return requestOtpChallenge(`/otp-challenges/${challengeId}/resend`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function createClaim(
  challengeId: string,
  earningIds: string[],
  idempotencyKey: string,
): Promise<Claim> {
  const input = createClaimInput.parse({ challengeId, earningIds });
  return requestJson("/claims", claimSchema, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}
