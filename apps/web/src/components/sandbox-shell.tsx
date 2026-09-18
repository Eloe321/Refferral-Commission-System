"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ActorRole } from "@referral-sandbox/contracts";
import { Button } from "@referral-sandbox/ui";
import { Check, ChevronDown, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { workboardPath } from "../lib/workbench-routes";
import { MobileNav } from "./mobile-nav";

export type SandboxShellProps = {
  children: ReactNode;
  initialRole: ActorRole;
  focusOnMount?: boolean;
  displayName?: string;
  guide?: ReactNode;
  onPersonaChange?: (role: ActorRole) => Promise<void> | void;
  onReset?: () => Promise<void> | void;
};

const personaNames: Record<ActorRole, string> = {
  owner: "Morgan",
  partner: "Jamie",
};

export function SandboxShell({
  children,
  initialRole,
  focusOnMount = false,
  displayName,
  guide,
  onPersonaChange,
  onReset,
}: SandboxShellProps) {
  const [role, setRole] = useState(initialRole);
  const [announcement, setAnnouncement] = useState("");
  const [switching, setSwitching] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "pending" | "success" | "error";
    message: string;
  } | null>(null);
  const personaSwitchInFlight = useRef(false);
  const resetInFlight = useRef(false);
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const previousPathname = useRef(pathname);
  const pendingMountFocus = useRef(focusOnMount);

  useEffect(() => {
    setRole(initialRole);
  }, [initialRole]);

  useEffect(() => {
    if (pendingMountFocus.current || previousPathname.current !== pathname) {
      pendingMountFocus.current = false;
      mainRef.current?.focus();
      const routeLabel = pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ");
      setAnnouncement(`${routeLabel ?? "Workbench"} page ready.`);
      previousPathname.current = pathname;
    }
  }, [pathname]);

  async function changePersona(nextRole: ActorRole): Promise<void> {
    if (nextRole === role || personaSwitchInFlight.current) return;
    personaSwitchInFlight.current = true;
    setSwitching(true);
    setFeedback({ kind: "pending", message: "Switching workbench…" });
    try {
      await onPersonaChange?.(nextRole);
      setRole(nextRole);
      const message = `${nextRole === "owner" ? "Owner" : "Partner"} workbench ready.`;
      setAnnouncement(message);
      setFeedback({ kind: "success", message });
    } catch {
      const message = "Persona switch failed. The current workbench is unchanged.";
      setAnnouncement(message);
      setFeedback({ kind: "error", message });
    } finally {
      personaSwitchInFlight.current = false;
      setSwitching(false);
    }
  }

  async function resetSandbox(): Promise<void> {
    if (!onReset || resetInFlight.current) return;
    resetInFlight.current = true;
    setResetting(true);
    setFeedback({ kind: "pending", message: "Resetting sandbox…" });
    setAnnouncement("Resetting sandbox.");
    try {
      await onReset();
      setFeedback({ kind: "success", message: "Sandbox reset complete." });
      setAnnouncement("Sandbox reset complete.");
    } catch {
      setFeedback({ kind: "error", message: "Sandbox reset failed. Try again." });
      setAnnouncement("Sandbox reset failed. Try again.");
    } finally {
      resetInFlight.current = false;
      setResetting(false);
    }
  }

  const currentName = displayName ?? personaNames[role];
  const currentPersona = `${currentName} · ${role}`;

  return (
    <div className="sandbox-shell">
      <a className="skip-link" href="#sandbox-main">
        Skip to work area
      </a>

      <header className="context-header">
        <Link
          className="brand-lockup"
          href={workboardPath(role)}
          aria-label="Northstar sandbox workboard"
          style={{ minBlockSize: "44px", minInlineSize: "44px" }}
        >
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <span className="brand-wordmark">
            <strong>Northstar</strong>
            <small>Referral operations</small>
          </span>
        </Link>

        <div className="header-controls">
          <span className="sandbox-badge">
            <ShieldCheck aria-hidden="true" size={15} /> Sandbox
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                className="persona-trigger"
                variant="secondary"
                aria-label={`Switch persona. Current persona: ${currentPersona}`}
                disabled={switching}
              >
                <span>
                  <span className="persona-name">{currentName}</span>
                  <span className="persona-separator" aria-hidden="true">
                    {" · "}
                  </span>
                  <span>{role}</span>
                </span>
                <ChevronDown aria-hidden="true" size={16} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="persona-menu" align="end" sideOffset={6}>
                <DropdownMenu.Label>View the same system as</DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={role}
                  onValueChange={(value) => void changePersona(value as ActorRole)}
                >
                  <DropdownMenu.RadioItem
                    className="persona-menu-item"
                    disabled={switching}
                    value="owner"
                  >
                    <DropdownMenu.ItemIndicator asChild>
                      <Check aria-hidden="true" size={15} />
                    </DropdownMenu.ItemIndicator>
                    <span>Owner view</span>
                    <small>Manage rules, partners and exceptions</small>
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem
                    className="persona-menu-item"
                    disabled={switching}
                    value="partner"
                  >
                    <DropdownMenu.ItemIndicator asChild>
                      <Check aria-hidden="true" size={15} />
                    </DropdownMenu.ItemIndicator>
                    <span>Partner view</span>
                    <small>Track referrals and claim earnings</small>
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <section className="guide-row" aria-label="Guided sandbox progress">
        {guide ?? (
          <div>
            <span className="guide-step">Step 1 of 8</span>
            <strong>Review how a referral earns commission</strong>
          </div>
        )}
        {!guide && onReset ? (
          <Button variant="quiet" disabled={resetting} onClick={() => void resetSandbox()}>
            <RotateCcw aria-hidden="true" size={16} />
            {resetting ? "Resetting sandbox" : "Reset sandbox"}
          </Button>
        ) : !guide ? (
          <span className="reset-unavailable">Reset unlocks in guided tour</span>
        ) : null}
      </section>

      <section className="proof-strip" aria-label="Sandbox proof points">
        <span>SMS preview · ₱0</span>
        <span>Real ledger rules</span>
        <span>Local sandbox data</span>
      </section>

      <MobileNav role={role} pathname={pathname} />

      <main ref={mainRef} id="sandbox-main" className="sandbox-main" tabIndex={-1}>
        {feedback ? (
          <p
            className={`operation-feedback operation-feedback--${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : undefined}
            aria-live="polite"
          >
            {feedback.message}
          </p>
        ) : null}
        <p className="simulation-notice">
          <ShieldCheck aria-hidden="true" size={17} />
          Money and messages are simulated. Business rules and audit history are real.
        </p>
        {children}
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
