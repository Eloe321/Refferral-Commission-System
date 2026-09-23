# 0001: Sandbox financial boundaries

**Status:** Accepted
**Date:** 2026-09-23

## Context

The sandbox demonstrates referral eligibility, claims, payouts, refunds, and recovery. These operations resemble financial software, so readers must be able to inspect arithmetic and history without mistaking the demo for a production payout platform.

## Decision

- Store monetary amounts in integer minor units and calculate with `bigint`.
- Select rules on the server and snapshot the selected rule on each earning.
- Keep claim authorization and lifecycle transitions on the server.
- Represent a refund after settlement with new reversal and recovery records, preserving the original payout.
- Keep the default demo on fictional data, preview notifications, and simulated payouts.

## Consequences

History remains auditable when rules change or a refund arrives. The sandbox needs explicit production boundaries in the UI and documentation. It does not move money or establish compliance for a real business.

## Alternatives considered

Recomputing old earnings from current rules would make historical results unstable. Editing a settled payout after refund would erase the original financial event. Both approaches were rejected for this sandbox.

See [Domain lifecycle](../domain-lifecycle.md) and [Privacy boundary](../privacy-boundary.md).
