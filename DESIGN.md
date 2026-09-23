# Northstar Referral Operations Design System

## Product context

- **Product:** A fictional home-services referral and commission sandbox for owners and partners.
- **Audience:** Prospective service-business clients and reviewers inspecting attribution, eligibility, claims, refunds, and audit history.
- **Memorable idea:** Every commission state has an understandable cause and a preserved record.
- **Project type:** Mobile-first operational web app with owner and partner workbenches.

This document records the existing interface and guides new screens. The live CSS in `apps/web/src/app/globals.css` remains the implementation source for token values.

## Aesthetic direction

- **Direction:** Industrial and utilitarian, with a calm financial-workflow tone.
- **Decoration:** Intentional, restrained. Dark structural surfaces frame light records; status colors identify state and action.
- **Layout:** Predictable workbench grid. Use clear panel headings, compact records, and visible next actions. On phones, stack controls and retain 44-pixel touch targets.
- **Distinctive choices:** Condensed display type gives workboard headings a strong identity; mint marks positive progress against the midnight shell. Use violet only for focus and recovery, not as a general decorative gradient.

## Typography

- **Display and major headings:** Barlow Condensed, weights 600 and 700. Its narrow forms keep operational headings compact.
- **Body and UI:** Manrope, weights 400 through 700. It stays readable in forms, explanations, and dense records.
- **Data:** Manrope with `font-variant-numeric: tabular-nums` for amounts and aligned figures. Use the existing monospace stack for IDs and audit references.
- **Loading:** Self-hosted `@fontsource` packages imported in `apps/web/src/app/layout.tsx`.
- **Scale:** Body 16px; small labels 12–13px; panel headings around 20–24px; workboard display headings scale responsively. Preserve the CSS hierarchy for existing pages.

## Color

| Role | Value | Use |
| --- | --- | --- |
| Midnight | `#0d1f2d` | Shell, sidebar, hero surfaces |
| Mint | `#54d2a0` | Progress, primary emphasis, eligible state |
| Cloud | `#f4f7f6` | Page background |
| Ink | `#17323c` | Main text |
| White | `#ffffff` | Record and form surfaces |
| Muted | `#607079` | Secondary text |
| Border | `#cad5d2` | Separation |
| Recovery violet | `#6d5dfc` | Focus and recovery emphasis |
| Hold amber | `#d89b2b` | Held or warning states |
| Danger | `#b42328` | Destructive and failed states |

Use the semantic soft backgrounds and text colors in `globals.css` for alerts. Pair every color status with a visible text label. The current app supports a light work surface with a dark shell; a full dark mode needs separate surface and contrast review before release.

## Spacing and shape

- **Base unit:** 4px. CSS tokens run from `--space-1` at 4px to `--space-6` at 32px.
- **Density:** Comfortable for touch, compact for data. Use 8–16px inside small controls and 16–24px between panel groups.
- **Content width:** 76rem maximum for the main work area.
- **Radii:** 8px small, 12px medium, 14px large. Use radius hierarchy rather than rounding every surface equally.
- **Shadow:** `--shadow-disciplined` only where elevation clarifies a drawer or floating surface.

## Motion and accessibility

- Use motion to confirm navigation or a state change; avoid decorative choreography in financial records.
- Honor `prefers-reduced-motion`. Keep focus outlines visible, announce asynchronous outcomes, and retain semantic status text.
- Form errors belong beside the field or action that needs correction. Audit explanations should lead with the event, rule, and next action in plain language.

## Decisions log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-23 | Document the existing Northstar visual system | New booking, event, and reporting screens should feel native to the current sandbox. |
