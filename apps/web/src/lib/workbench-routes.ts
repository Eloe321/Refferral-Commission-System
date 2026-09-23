import type { ActorRole } from "@referral-sandbox/contracts";

export type WorkbenchDestination = {
  label: string;
  href: `/${ActorRole}/${string}`;
  section: string;
};

export const workbenchRoutes = {
  owner: [
    { label: "Workboard", href: "/owner/workboard", section: "workboard" },
    { label: "Programs", href: "/owner/programs", section: "programs" },
    { label: "Bookings", href: "/owner/bookings", section: "bookings" },
    { label: "Earnings", href: "/owner/earnings", section: "earnings" },
    { label: "Reports", href: "/owner/reports", section: "reports" },
    { label: "Partners", href: "/owner/partners", section: "partners" },
  ],
  partner: [
    { label: "Workboard", href: "/partner/workboard", section: "workboard" },
    { label: "Referrals", href: "/partner/referrals", section: "referrals" },
    { label: "Earnings", href: "/partner/earnings", section: "earnings" },
    { label: "Claims", href: "/partner/claims", section: "claims" },
  ],
} as const satisfies Record<ActorRole, readonly WorkbenchDestination[]>;

export function roleFromPathname(pathname: string): ActorRole | null {
  const role = pathname.split("/").filter(Boolean)[0];
  return role === "owner" || role === "partner" ? role : null;
}

export function activeWorkbenchDestination(
  role: ActorRole,
  pathname: string,
): WorkbenchDestination["href"] | null {
  const match = workbenchRoutes[role].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.href ?? null;
}

export function workboardPath(role: ActorRole): `/${ActorRole}/workboard` {
  return `/${role}/workboard`;
}
