"use client";

import type { AuditEvent, Conversion } from "@referral-sandbox/contracts";
import { Button } from "@referral-sandbox/ui";
import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getOwnerOverview, type OwnerOverview } from "../../lib/api-client";
import { useSandboxWorkspace } from "../sandbox/sandbox-workspace-provider";
import type { OperationNotice } from "./earning-controls";

export type OwnerWorkspaceValue = {
  overview: OwnerOverview;
  conversions: Conversion[];
  auditEvents: AuditEvent[];
  notice: OperationNotice | null;
  staleNotice: string | null;
  referenceByItem: ReadonlyMap<string, string>;
  settledByPartner: ReadonlyMap<string, ReadonlyMap<string, string>>;
  refresh: () => Promise<void>;
  replaceConversion: (conversion: Conversion) => void;
  setNotice: (notice: OperationNotice | null) => void;
};

type OwnerState =
  { status: "loading" } | { status: "error" } | { status: "ready"; overview: OwnerOverview };

const OwnerWorkspaceContext = createContext<OwnerWorkspaceValue | null>(null);

export function OwnerWorkspaceProvider({ children }: { children: ReactNode }) {
  const { workspace } = useSandboxWorkspace();
  if (workspace.role !== "owner") {
    throw new Error("OwnerWorkspaceProvider requires an owner workspace");
  }
  const [state, setState] = useState<OwnerState>({ status: "loading" });
  const [conversions, setConversions] = useState(workspace.conversions);
  const [notice, setNotice] = useState<OperationNotice | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const overviewRef = useRef<OwnerOverview | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const overview = await getOwnerOverview();
      if (generation !== loadGeneration.current) return;
      overviewRef.current = overview;
      setState({ status: "ready", overview });
      setStaleNotice(null);
    } catch {
      if (generation !== loadGeneration.current) return;
      if (overviewRef.current) {
        setState({ status: "ready", overview: overviewRef.current });
        setStaleNotice("Refresh unavailable. Showing the last successful records.");
      } else {
        setState({ status: "error" });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load, workspace]);

  useEffect(() => {
    setConversions(workspace.conversions);
  }, [workspace]);

  const referenceByItem = useMemo(
    () =>
      new Map(
        conversions.flatMap((conversion) =>
          conversion.items.map((item) => [item.id, item.externalRef] as const),
        ),
      ),
    [conversions],
  );
  const overview = state.status === "ready" ? state.overview : null;
  const settledByPartner = useMemo(() => {
    const totals = new Map<string, Map<string, string>>();
    for (const claim of overview?.claims ?? []) {
      if (claim.status !== "settled") continue;
      const currencies = totals.get(claim.partnerId) ?? new Map<string, string>();
      currencies.set(
        claim.amount.currency,
        (
          BigInt(currencies.get(claim.amount.currency) ?? "0") + BigInt(claim.amount.amountMinor)
        ).toString(),
      );
      totals.set(claim.partnerId, currencies);
    }
    return totals;
  }, [overview]);

  if (state.status === "loading") {
    return (
      <section className="owner-boundary" aria-busy="true">
        <LoaderCircle className="loading-icon" aria-hidden="true" size={24} />
        <p>Loading the owner workboard…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="owner-boundary" role="alert">
        <AlertTriangle aria-hidden="true" size={24} />
        <h1>Owner workboard unavailable</h1>
        <p>The local API did not return the expected owner records.</p>
        <Button onClick={() => void load()} aria-label="Refresh owner records">
          <RefreshCw aria-hidden="true" size={17} /> Try again
        </Button>
      </section>
    );
  }

  const value: OwnerWorkspaceValue = {
    overview: state.overview,
    conversions,
    auditEvents: workspace.auditEvents,
    notice,
    staleNotice,
    referenceByItem,
    settledByPartner,
    refresh: load,
    replaceConversion: (updated) => {
      setConversions((current) =>
        current.map((conversion) => (conversion.id === updated.id ? updated : conversion)),
      );
    },
    setNotice,
  };

  return <OwnerWorkspaceContext.Provider value={value}>{children}</OwnerWorkspaceContext.Provider>;
}

export function useOwnerWorkspace(): OwnerWorkspaceValue {
  const value = useContext(OwnerWorkspaceContext);
  if (!value) throw new Error("useOwnerWorkspace must be used inside OwnerWorkspaceProvider");
  return value;
}

export function OwnerNotices() {
  const { notice, staleNotice } = useOwnerWorkspace();
  return (
    <>
      {staleNotice ? (
        <p className="owner-notice owner-notice--error" role="alert">
          {staleNotice}
        </p>
      ) : null}
      {notice ? (
        <p
          className={`owner-notice owner-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.message}
        </p>
      ) : null}
    </>
  );
}
