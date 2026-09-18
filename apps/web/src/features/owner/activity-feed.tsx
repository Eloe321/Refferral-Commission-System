import type { AuditEvent } from "@referral-sandbox/contracts";

import { EventTimeline } from "../../components/event-timeline";

export type ActivityFeedProps = { events: AuditEvent[] };

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <section id="activity" className="owner-panel" aria-labelledby="activity-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Proof trail</p>
          <h2 id="activity-title">Server-observed audit history</h2>
        </div>
        <p>
          Server-observed records are authoritative. Local confirmations below are interface
          feedback until the audit read route is connected.
        </p>
      </div>
      <EventTimeline events={events} />
    </section>
  );
}
