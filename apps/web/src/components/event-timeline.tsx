import type { AuditEvent } from "@referral-sandbox/contracts";

export type EventTimelineProps = { events: AuditEvent[] };

function labelAction(action: string): string {
  const words = action.replaceAll(".", " ").replaceAll("_", " ");
  return words.replace(/^./, (letter) => letter.toUpperCase());
}

export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="owner-empty">No server-observed audit events were supplied to this view.</p>
    );
  }

  return (
    <ol className="event-timeline" aria-label="Server-observed audit history">
      {events.map((event) => (
        <li key={event.id}>
          <span className="event-timeline__marker" aria-hidden="true" />
          <div>
            <div className="event-timeline__heading">
              <strong>{labelAction(event.action)}</strong>
              <span>Server-observed event</span>
            </div>
            <div className="event-timeline__context">
              <span className="data-id">
                {event.isSystemEvent || !event.actorId ? "System" : `Operator · ${event.actorId}`}
              </span>
              <span className="data-id">
                {event.aggregateType} · {event.aggregateId}
              </span>
            </div>
            {event.reason ? <p>{event.reason}</p> : null}
            <time dateTime={event.createdAt}>
              {new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              }).format(new Date(event.createdAt))}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
