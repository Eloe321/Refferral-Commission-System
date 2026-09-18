"use client";

import type { ActorRole, DemoWorkspace, GuideState } from "@referral-sandbox/contracts";
import { Button, StatusBadge } from "@referral-sandbox/ui";
import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SandboxShell } from "../../components/sandbox-shell";
import { workboardPath, roleFromPathname } from "../../lib/workbench-routes";
import { GuideCard } from "../guide/guide-card";
import { GuideProvider } from "../guide/guide-provider";
import { ResetSandbox } from "../guide/reset-sandbox";
import {
  advanceGuide,
  createDemoSession,
  getDemoWorkspace,
  getGuideState,
  probeDemoSession,
  readDemoSession,
  resetDemoSandbox,
  type SessionActor,
} from "../../lib/api-client";

export type ReadySandbox = {
  session: SessionActor;
  workspace: DemoWorkspace;
  guide: GuideState;
  notice?: { kind: "success" | "error"; message: string };
  needsWorkspaceRefresh?: boolean;
};
type SandboxProviderState =
  | { status: "loading"; message: string }
  | ({ status: "ready"; pendingDestination?: string; focusOnMount?: boolean } & ReadySandbox)
  | { status: "error" };
type SandboxWorkspaceValue = ReadySandbox & {
  refreshWorkspace: () => Promise<void>;
  openDestination: (role: ActorRole, href: string) => Promise<void>;
};
const SandboxWorkspaceContext = createContext<SandboxWorkspaceValue | null>(null);

export function assertSandboxBundle(
  session: SessionActor,
  workspace: DemoWorkspace,
  guide: GuideState,
): void {
  if (
    workspace.role !== session.role ||
    workspace.organizationId !== session.organizationId ||
    guide.organizationId !== session.organizationId ||
    workspace.sandboxVersion !== session.sandboxVersion ||
    guide.sandboxVersion !== session.sandboxVersion ||
    (session.role === "partner" &&
      (workspace.role !== "partner" || workspace.partnerId !== session.partnerId))
  ) {
    throw new Error("The demo workspace does not match the signed session");
  }
}

export async function loadBundle(
  session: SessionActor,
): Promise<{ status: "ready" } & ReadySandbox> {
  const [workspace, guide] = await Promise.all([getDemoWorkspace(), getGuideState()]);
  assertSandboxBundle(session, workspace, guide);
  return { status: "ready", session, workspace, guide };
}

export function SandboxWorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const requestedRole = roleFromPathname(pathname);
  const [state, setProviderState] = useState<SandboxProviderState>({
    status: "loading",
    message: "Opening the local sandbox…",
  });
  const generation = useRef(0);
  const sessionOperations = useRef<Promise<void>>(Promise.resolve());
  const sessionChangeInFlight = useRef(false);
  const stateRef = useRef(state);
  const hasReadyWorkspace = useRef(false);
  const setState = useCallback((next: SandboxProviderState) => {
    if (next.status === "ready") hasReadyWorkspace.current = true;
    stateRef.current = next;
    setProviderState(next);
  }, []);
  const runSessionOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
    // Cookie writes cannot be cancelled by a generation check. Reconcile the latest
    // route only after the preceding operation (including its recovery) has settled.
    const running = sessionOperations.current.then(operation);
    sessionOperations.current = running.catch(() => {});
    return running;
  }, []);

  const openSession = useCallback(
    async (preferredRole: ActorRole | null) => {
      const request = ++generation.current;
      const focusOnMount = hasReadyWorkspace.current;
      setState({ status: "loading", message: "Opening the local sandbox…" });
      await runSessionOperation(async () => {
        if (request !== generation.current) return;
        try {
          let session = await probeDemoSession();
          if (request !== generation.current) return;
          session ??= await createDemoSession(preferredRole ?? "owner");
          if (request !== generation.current) return;
          if (preferredRole && session.role !== preferredRole) {
            session = await createDemoSession(preferredRole);
          }
          if (request !== generation.current) return;
          const next = await loadBundle(session);
          if (request === generation.current) {
            setState({ ...next, focusOnMount });
          }
        } catch {
          if (request === generation.current) setState({ status: "error" });
        }
      });
    },
    [runSessionOperation, setState],
  );

  useEffect(() => {
    const current = stateRef.current;
    if (current.status === "ready" && (!requestedRole || current.session.role === requestedRole)) {
      return;
    }
    void openSession(requestedRole);
  }, [openSession, pathname, requestedRole, setState]);

  const pendingDestination = state.status === "ready" ? state.pendingDestination : undefined;
  useEffect(() => {
    const current = stateRef.current;
    if (current.status === "ready" && current.pendingDestination === pathname) {
      const ready = { ...current };
      delete ready.pendingDestination;
      setState(ready);
    }
  }, [pendingDestination, pathname, setState]);

  const focusOnMount = state.status === "ready" && state.focusOnMount === true;
  useEffect(() => {
    const current = stateRef.current;
    if (focusOnMount && current.status === "ready" && current.focusOnMount) {
      setState({ ...current, focusOnMount: false });
    }
  }, [focusOnMount, setState]);

  useEffect(() => {
    if (pathname === "/" && state.status === "ready") {
      router.replace(workboardPath(state.session.role));
    }
  }, [pathname, router, state]);

  if (
    state.status === "loading" ||
    (state.status === "ready" &&
      ((requestedRole && state.session.role !== requestedRole) ||
        (state.pendingDestination && state.pendingDestination !== pathname)))
  ) {
    return (
      <main className="boundary-screen" aria-busy="true">
        <div className="boundary-card" role="status" aria-live="polite">
          <LoaderCircle className="loading-icon" aria-hidden="true" size={24} />
          <p>
            {state.status === "loading"
              ? state.message
              : state.pendingDestination
                ? "Switching workbench…"
                : "Opening the local sandbox…"}
          </p>
          <small>Loading a signed fictional business session and its local records.</small>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="boundary-screen">
        <div className="boundary-card" role="alert">
          <StatusBadge status="failed" label="Local API unavailable" />
          <h1>Could not open the local sandbox</h1>
          <p>Start the local API, then try again. No external service is required for this view.</p>
          <Button onClick={() => void openSession(requestedRole)}>Try again</Button>
        </div>
      </main>
    );
  }

  const ready = state;

  async function switchPersona(
    role: ActorRole,
    destination: string = workboardPath(role),
  ): Promise<void> {
    if (sessionChangeInFlight.current) {
      throw new Error("A session change is already in progress");
    }
    sessionChangeInFlight.current = true;
    const request = ++generation.current;
    const previous = stateRef.current;
    let sessionRotated = false;
    setState({ status: "loading", message: "Switching workbench…" });
    return runSessionOperation(async () => {
      try {
        if (request !== generation.current) return;
        const session = await createDemoSession(role);
        sessionRotated = true;
        if (request !== generation.current) return;
        if (
          previous.status === "ready" &&
          ((previous.guide.stage === "switch_to_partner" && role === "partner") ||
            (previous.guide.stage === "switch_to_owner" && role === "owner"))
        ) {
          await advanceGuide();
        }
        if (request !== generation.current) return;
        const next = await loadBundle(session);
        if (request === generation.current) {
          setState({ ...next, pendingDestination: destination });
          router.replace(destination);
        }
      } catch (error) {
        if (request === generation.current) {
          if (!sessionRotated) {
            setState(
              previous.status === "ready"
                ? {
                    ...previous,
                    notice: {
                      kind: "error",
                      message: "Persona switch failed. The previous workbench is restored.",
                    },
                  }
                : previous,
            );
          } else {
            try {
              const recovered = await loadBundle(await readDemoSession());
              if (request === generation.current) {
                setState({
                  ...recovered,
                  pendingDestination: workboardPath(recovered.session.role),
                });
                router.replace(workboardPath(recovered.session.role));
              }
            } catch {
              if (request === generation.current) setState({ status: "error" });
            }
          }
        }
        throw error;
      } finally {
        sessionChangeInFlight.current = false;
      }
    });
  }

  async function checkProgress(): Promise<void> {
    const request = ++generation.current;
    const previous = stateRef.current;
    if (previous.status !== "ready") return;
    try {
      if (previous.needsWorkspaceRefresh) {
        const [workspace, guide] = await Promise.all([getDemoWorkspace(), getGuideState()]);
        assertSandboxBundle(previous.session, workspace, guide);
        if (request === generation.current) {
          setState({ status: "ready", session: previous.session, workspace, guide });
        }
        return;
      }
      const guide = await advanceGuide();
      if (request === generation.current) {
        setState({
          ...previous,
          guide,
          notice: {
            kind: "error",
            message: "Progress was saved, but business records could not refresh yet.",
          },
          needsWorkspaceRefresh: true,
        });
      }
      const workspace = await getDemoWorkspace();
      assertSandboxBundle(previous.session, workspace, guide);
      if (request === generation.current) {
        setState({ status: "ready", session: previous.session, workspace, guide });
      }
    } catch (error) {
      generation.current = Math.max(generation.current, request);
      throw error;
    }
  }

  async function reset(): Promise<void> {
    if (sessionChangeInFlight.current) {
      throw new Error("A session change is already in progress");
    }
    sessionChangeInFlight.current = true;
    const request = ++generation.current;
    setState({ status: "loading", message: "Resetting sandbox…" });
    return runSessionOperation(async () => {
      try {
        if (request !== generation.current) return;
        const result = await resetDemoSandbox();
        if (request !== generation.current) return;
        const [workspace, guide] = await Promise.all([getDemoWorkspace(), getGuideState()]);
        assertSandboxBundle(result.session, workspace, guide);
        if (request === generation.current) {
          setState({
            status: "ready",
            session: result.session,
            workspace,
            guide,
            notice: { kind: "success", message: "Sandbox reset complete." },
            pendingDestination: workboardPath(result.session.role),
          });
          router.replace(workboardPath(result.session.role));
        }
      } catch (error) {
        if (request === generation.current) {
          try {
            const recovered = await loadBundle(await readDemoSession());
            if (request === generation.current) {
              setState({
                ...recovered,
                pendingDestination: workboardPath(recovered.session.role),
                notice: {
                  kind: "error",
                  message: "Reset could not be confirmed. The signed workspace was reloaded.",
                },
              });
              router.replace(workboardPath(recovered.session.role));
            }
          } catch {
            if (request === generation.current) setState({ status: "error" });
          }
        }
        throw error;
      } finally {
        sessionChangeInFlight.current = false;
      }
    });
  }

  async function refreshWorkspace(): Promise<void> {
    const previous = stateRef.current;
    if (previous.status !== "ready") return;
    const request = generation.current;
    const workspace = await getDemoWorkspace();
    const current = stateRef.current;
    if (request !== generation.current || current.status !== "ready") return;
    assertSandboxBundle(current.session, workspace, current.guide);
    setState({ ...current, workspace });
  }

  async function openDestination(role: ActorRole, href: string): Promise<void> {
    const current = stateRef.current;
    if (current.status !== "ready") return;
    if (current.session.role === role) {
      router.push(href);
      return;
    }
    await switchPersona(role, href);
  }

  if (pathname === "/") return null;

  const value: SandboxWorkspaceValue = { ...ready, refreshWorkspace, openDestination };

  return (
    <SandboxWorkspaceContext.Provider value={value}>
      <GuideProvider
        state={ready.guide}
        needsWorkspaceRefresh={ready.needsWorkspaceRefresh ?? false}
        onAdvance={checkProgress}
        onSwitchPersona={(role) => switchPersona(role)}
        onOpenDestination={openDestination}
      >
        <SandboxShell
          initialRole={ready.session.role}
          focusOnMount={focusOnMount || ready.pendingDestination === pathname}
          displayName={ready.session.displayName}
          onPersonaChange={(role) => switchPersona(role)}
          guide={
            <>
              <GuideCard />
              <ResetSandbox onReset={reset} />
            </>
          }
        >
          {ready.notice ? (
            <p
              className={`owner-notice owner-notice--${ready.notice.kind}`}
              role={ready.notice.kind === "success" ? "status" : "alert"}
            >
              {ready.notice.message}
            </p>
          ) : null}
          {children}
        </SandboxShell>
      </GuideProvider>
    </SandboxWorkspaceContext.Provider>
  );
}

export function useSandboxWorkspace(): SandboxWorkspaceValue {
  const value = useContext(SandboxWorkspaceContext);
  if (!value) {
    throw new Error("useSandboxWorkspace must be used inside SandboxWorkspaceProvider");
  }
  return value;
}
