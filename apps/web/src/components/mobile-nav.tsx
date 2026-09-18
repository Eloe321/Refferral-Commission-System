"use client";

import type { ActorRole } from "@referral-sandbox/contracts";
import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ClipboardList,
  HandCoins,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { activeWorkbenchDestination, workbenchRoutes } from "../lib/workbench-routes";

const icons: Record<ActorRole, Record<string, LucideIcon>> = {
  owner: {
    workboard: BriefcaseBusiness,
    programs: ClipboardList,
    earnings: BadgeDollarSign,
    partners: UsersRound,
  },
  partner: {
    workboard: BriefcaseBusiness,
    referrals: UsersRound,
    earnings: BadgeDollarSign,
    claims: HandCoins,
  },
};

export function MobileNav({ role, pathname }: { role: ActorRole; pathname: string }) {
  const activeHref = activeWorkbenchDestination(role, pathname);
  return (
    <nav className="primary-navigation" aria-label="Primary navigation">
      <p className="navigation-kicker" aria-hidden="true">
        {role === "owner" ? "Owner console" : "Partner console"}
      </p>
      <ul>
        {workbenchRoutes[role].map((item) => {
          const Icon = icons[role][item.section];
          if (!Icon) throw new Error(`Missing navigation icon for ${role}:${item.section}`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="mobile-nav__link"
                aria-current={activeHref === item.href ? "page" : undefined}
                style={{ minBlockSize: "44px" }}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
