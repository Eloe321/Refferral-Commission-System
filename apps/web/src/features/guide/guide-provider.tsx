"use client";

import type { ActorRole, GuideState } from "@referral-sandbox/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type GuideContextValue = {
  state: GuideState;
  pending: boolean;
  feedback: { kind: "success" | "error"; message: string } | null;
  needsWorkspaceRefresh: boolean;
  advance: () => Promise<void>;
  switchPersona: (role: ActorRole) => Promise<void>;
  openDestination: (role: ActorRole, href: string) => Promise<void>;
};

const GuideContext = createContext<GuideContextValue | null>(null);

export type GuideProviderProps = {
  state: GuideState;
  onAdvance: () => Promise<void>;
  needsWorkspaceRefresh?: boolean;
  onSwitchPersona?: (role: ActorRole) => Promise<void>;
  onOpenDestination?: (role: ActorRole, href: string) => Promise<void>;
  children: ReactNode;
};

export function GuideProvider({
  state,
  onAdvance,
  onSwitchPersona,
  onOpenDestination,
  needsWorkspaceRefresh = false,
  children,
}: GuideProviderProps) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<GuideContextValue["feedback"]>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setFeedback(null);
  }, [state.stage, state.sandboxVersion]);

  async function run(operation: () => Promise<void>, success: string): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      await operation();
      setFeedback({ kind: "success", message: success });
    } catch {
      setFeedback({
        kind: "error",
        message: "Complete the recommended action, then check progress again.",
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const value = useMemo<GuideContextValue>(
    () => ({
      state,
      needsWorkspaceRefresh,
      pending,
      feedback,
      advance: () => run(onAdvance, "Progress checked. The next work order is ready."),
      switchPersona: (role) =>
        run(
          async () => {
            if (!onSwitchPersona) throw new Error("Persona switch unavailable");
            await onSwitchPersona(role);
          },
          `${role === "owner" ? "Owner" : "Partner"} workbench ready.`,
        ),
      openDestination: (role, href) =>
        run(
          async () => {
            if (!onOpenDestination) throw new Error("Destination navigation unavailable");
            await onOpenDestination(role, href);
          },
          `${role === "owner" ? "Owner" : "Partner"} page ready.`,
        ),
    }),
    [
      feedback,
      needsWorkspaceRefresh,
      onAdvance,
      onOpenDestination,
      onSwitchPersona,
      pending,
      state,
    ],
  );

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useGuide(): GuideContextValue {
  const value = useContext(GuideContext);
  if (!value) throw new Error("useGuide must be used inside GuideProvider");
  return value;
}
