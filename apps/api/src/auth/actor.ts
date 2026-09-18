import type { ActorRole } from "@referral-sandbox/contracts";

export type Actor = Readonly<{
  actorId: string;
  organizationId: string;
  role: ActorRole;
  partnerId: string | null;
  displayName: string;
  sandboxVersion: number;
}>;

export const SESSION_COOKIE_NAME = "sandbox_session";
