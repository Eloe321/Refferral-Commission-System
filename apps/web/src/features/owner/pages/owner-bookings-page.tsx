"use client";

import type { BookingWebhookEvent, Conversion } from "@referral-sandbox/contracts";
import { Button, StatusBadge } from "@referral-sandbox/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import {
  ApiError,
  createBookingConversion,
  deliverDemoBookingCompletion,
  getBookingWebhookEvents,
  retryBookingWebhookEvent,
} from "../../../lib/api-client";
import { parseRefundMajorToMinor } from "../../../lib/refund-money";
import { useSandboxWorkspace } from "../../sandbox/sandbox-workspace-provider";
import { OwnerNotices, useOwnerWorkspace } from "../owner-workspace-provider";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message.replaceAll("_", " ") : fallback;
}

export function OwnerBookingsPage() {
  const { overview, conversions, refresh, setNotice } = useOwnerWorkspace();
  const { refreshWorkspace } = useSandboxWorkspace();
  const activePrograms = overview.programs.filter((program) => program.status === "active");
  const currency = overview.earnings[0]?.amount.currency ?? conversions[0]?.currency ?? "USD";
  const [programId, setProgramId] = useState(activePrograms[0]?.id ?? "");
  const [bookingRef, setBookingRef] = useState("");
  const [referralCode, setReferralCode] = useState("JAMIE12");
  const [category, setCategory] = useState("plumbing");
  const [value, setValue] = useState("180.00");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [events, setEvents] = useState<BookingWebhookEvent[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  const loadEvents = useCallback(async () => {
    try {
      setEvents(await getBookingWebhookEvents());
      setEventError(null);
    } catch {
      setEventError("Event history could not be loaded. Try refreshing the page.");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function refreshRecords(): Promise<void> {
    await refreshWorkspace();
    await refresh();
    await loadEvents();
  }

  async function createBooking(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const selectedProgram = activePrograms.find((program) => program.id === programId);
    if (!selectedProgram) {
      setFormError("Choose an active commission program.");
      return;
    }
    let grossAmountMinor: string;
    try {
      grossAmountMinor = parseRefundMajorToMinor(value, currency);
    } catch {
      setFormError("Enter a positive service value using the currency's normal decimal places.");
      return;
    }
    setBusy(true);
    try {
      const created = await createBookingConversion({
        idempotencyKey: idempotencyKey.current,
        externalRef: bookingRef.trim(),
        programId: selectedProgram.id,
        referralCode: referralCode.trim(),
        currency,
        items: [
          {
            externalRef: `${bookingRef.trim()}-service`,
            category: category.trim(),
            grossAmountMinor,
          },
        ],
      });
      idempotencyKey.current = crypto.randomUUID();
      setBookingRef("");
      await refreshRecords();
      setNotice({ kind: "success", message: `Fictional booking ${created.externalRef} created.` });
    } catch (error) {
      setFormError(errorMessage(error, "Booking could not be created. Check the fields and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function deliver(conversion: Conversion): Promise<void> {
    if (workingId) return;
    setWorkingId(conversion.id);
    try {
      const receipt = await deliverDemoBookingCompletion(conversion.id);
      await refreshRecords();
      setNotice({
        kind: receipt.status === "processed" ? "success" : "error",
        message:
          receipt.status === "processed"
            ? `Event processed for ${conversion.externalRef}.`
            : `Event ${receipt.status} for ${conversion.externalRef}.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error, "Completion event failed. Try again.") });
    } finally {
      setWorkingId(null);
    }
  }

  async function retry(event: BookingWebhookEvent): Promise<void> {
    if (workingId) return;
    setWorkingId(event.id);
    try {
      const receipt = await retryBookingWebhookEvent(event.providerEventId);
      await refreshRecords();
      setNotice({
        kind: receipt.status === "processed" ? "success" : "error",
        message: `Retry ${receipt.status} for ${event.bookingRef}.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error, "Event retry failed. Try again.") });
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Booking integration"
        title="Bookings and events"
        description="Create a fictional referred booking, deliver a signed service-completion event, and inspect the reason its commission changed."
      />
      <OwnerNotices />
      <section className="owner-panel" aria-labelledby="booking-create-title">
        <div className="owner-panel__heading">
          <div>
            <p className="eyebrow">Customer booking simulation</p>
            <h2 id="booking-create-title">Create a referred booking</h2>
          </div>
          <p>The sandbox records a fictional service value and partner code. No customer details are collected.</p>
        </div>
        <form className="booking-form" onSubmit={(event) => void createBooking(event)}>
          <label>
            Commission program
            <select value={programId} onChange={(event) => { setProgramId(event.target.value); }} required>
              {activePrograms.map((program) => (
                <option key={program.id} value={program.id}>{program.name}</option>
              ))}
            </select>
          </label>
          <label>
            Booking reference
            <input value={bookingRef} onChange={(event) => { setBookingRef(event.target.value); }} minLength={1} maxLength={112} required placeholder="BOOKING-001" />
          </label>
          <label>
            Referral code
            <input value={referralCode} onChange={(event) => { setReferralCode(event.target.value); }} minLength={3} maxLength={40} required />
          </label>
          <label>
            Service category
            <input value={category} onChange={(event) => { setCategory(event.target.value); }} minLength={1} maxLength={80} required />
          </label>
          <label>
            Service value
            <input value={value} onChange={(event) => { setValue(event.target.value); }} inputMode="decimal" required />
          </label>
          <div className="booking-form__action">
            {formError ? <p role="alert">{formError}</p> : null}
            <Button type="submit" disabled={busy || activePrograms.length === 0}>
              {busy ? "Creating booking…" : "Create fictional booking"}
            </Button>
          </div>
        </form>
      </section>

      <section className="owner-panel" aria-labelledby="booking-pending-title">
        <div className="owner-panel__heading">
          <div>
            <p className="eyebrow">Eligibility gate</p>
            <h2 id="booking-pending-title">Bookings awaiting completion</h2>
          </div>
          <p>Deliver a signed sample event through the same server path used by a booking provider.</p>
        </div>
        {conversions.filter((conversion) => conversion.status === "scheduled").length ? (
          <div className="booking-records">
            {conversions.filter((conversion) => conversion.status === "scheduled").map((conversion) => (
              <article className="booking-record" key={conversion.id}>
                <div>
                  <strong className="data-id">{conversion.externalRef}</strong>
                  <StatusBadge status={conversion.status} />
                  <p>{conversion.items.map((item) => item.category).join(", ")}</p>
                </div>
                <Button
                  disabled={workingId !== null}
                  onClick={() => void deliver(conversion)}
                  aria-label={`Deliver completion event for ${conversion.externalRef}`}
                >
                  {workingId === conversion.id ? "Delivering event…" : "Deliver completion event"}
                </Button>
              </article>
            ))}
          </div>
        ) : <p className="owner-empty">No bookings are waiting for completion.</p>}
      </section>

      <section className="owner-panel" aria-labelledby="booking-events-title">
        <div className="owner-panel__heading">
          <div>
            <p className="eyebrow">Provider event ledger</p>
            <h2 id="booking-events-title">Completion events</h2>
          </div>
          <div>
            <p>Duplicate delivery cannot make the same commission eligible twice. Failed events remain visible for retry.</p>
            <Button variant="secondary" onClick={() => { void loadEvents(); }}>Refresh event history</Button>
          </div>
        </div>
        {eventError ? <p role="alert">{eventError}</p> : null}
        {events.length ? (
          <div className="booking-records">
            {events.map((event) => (
              <article className="booking-record" key={event.id}>
                <div>
                  <strong className="data-id">{event.bookingRef}</strong>
                  <StatusBadge status={event.status} label={event.status} />
                  <p>{event.eventType} · {event.attempts} attempt{event.attempts === 1 ? "" : "s"}</p>
                  {event.confirmationStatus ? <p>Partner confirmation email: {event.confirmationStatus} (local Mailpit outbox)</p> : null}
                  {event.failureCode ? <p className="booking-record__failure">{event.failureCode.replaceAll("_", " ")}</p> : null}
                </div>
                {event.status === "failed" ? (
                  <Button variant="secondary" disabled={workingId !== null} onClick={() => void retry(event)} aria-label={`Retry event ${event.providerEventId}`}>
                    {workingId === event.id ? "Retrying…" : "Retry event"}
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        ) : <p className="owner-empty">No completion events have been delivered yet.</p>}
      </section>

      <p className="booking-next-step">
        Next: <Link href="/owner/earnings">inspect the eligible earning and its rule snapshot</Link>.
        The partner can then authorize a claim with OTP, and the owner can simulate settlement and a refund.
      </p>
    </div>
  );
}
