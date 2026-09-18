"use client";

import type { LedgerEntry } from "@referral-sandbox/contracts";
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

import { getPartnerOverview, type PartnerOverview } from "../../lib/api-client";
import { useSandboxWorkspace } from "../sandbox/sandbox-workspace-provider";
import { projectPartnerFinancials, type PartnerFinancials } from "./partner-financials";
import type { PublicReferral } from "./referral-code-card";

export type PartnerWorkspaceValue = {
  overview: PartnerOverview;
  referral: PublicReferral;
  ledgerEntries: LedgerEntry[];
  financials: PartnerFinancials;
  staleNotice: string | null;
  refresh: () => Promise<void>;
};

type PartnerWorkspaceState =
  | { status: "loading"; partnerId: string }
  | { status: "error"; partnerId: string }
  | { status: "ready"; partnerId: string; overview: PartnerOverview };

const PartnerWorkspaceContext = createContext<PartnerWorkspaceValue | null>(null);

export function PartnerWorkspaceProvider({ children }: { children: ReactNode }) {
  const { workspace } = useSandboxWorkspace();
  if (workspace.role !== "partner") {
    throw new Error("PartnerWorkspaceProvider requires a partner workspace");
  }
  const { partnerId, referral, ledgerEntries } = workspace;
  const [state, setState] = useState<PartnerWorkspaceState>({
    status: "loading",
    partnerId,
  });
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const overviewRef = useRef<{ partnerId: string; overview: PartnerOverview } | null>(null);
  const loadGeneration = useRef(0);
  const activePartnerId = useRef(partnerId);
  activePartnerId.current = partnerId;

  const load = useCallback(async () => {
    if (activePartnerId.current !== partnerId) return;
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    try {
      const overview = await getPartnerOverview(partnerId);
      if (generation !== loadGeneration.current || activePartnerId.current !== partnerId) return;
      overviewRef.current = { partnerId, overview };
      setState({ status: "ready", partnerId, overview });
      setStaleNotice(null);
    } catch {
      if (generation !== loadGeneration.current || activePartnerId.current !== partnerId) return;
      const previous = overviewRef.current;
      if (previous?.partnerId === partnerId) {
        setState({ status: "ready", partnerId, overview: previous.overview });
        setStaleNotice("Refresh unavailable. Showing the last successful records.");
      } else {
        setState({ status: "error", partnerId });
      }
    }
  }, [partnerId]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load, workspace]);

  const overview = state.status === "ready" ? state.overview : null;
  const financials = useMemo(
    () => (overview ? projectPartnerFinancials(overview) : null),
    [overview],
  );

  if (state.partnerId !== partnerId || state.status === "loading") {
    return (
      <section className="owner-boundary" aria-busy="true">
        <LoaderCircle className="loading-icon" aria-hidden="true" size={24} />
        <p>Loading the partner workboard…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="owner-boundary" role="alert">
        <AlertTriangle aria-hidden="true" size={24} />
        <h1>Partner workboard unavailable</h1>
        <p>The local API did not return the expected partner records.</p>
        <Button onClick={() => void load()}>
          <RefreshCw aria-hidden="true" size={17} /> Try again
        </Button>
      </section>
    );
  }

  if (!financials) return null;
  const value: PartnerWorkspaceValue = {
    overview: state.overview,
    referral,
    ledgerEntries,
    financials,
    staleNotice,
    refresh: load,
  };
  return (
    <PartnerWorkspaceContext.Provider value={value}>
      {staleNotice ? (
        <p className="partner-notice partner-notice--error" role="alert">
          {staleNotice}
        </p>
      ) : null}
      {children}
    </PartnerWorkspaceContext.Provider>
  );
}

export function usePartnerWorkspace(): PartnerWorkspaceValue {
  const value = useContext(PartnerWorkspaceContext);
  if (!value) throw new Error("usePartnerWorkspace must be used inside PartnerWorkspaceProvider");
  return value;
}
