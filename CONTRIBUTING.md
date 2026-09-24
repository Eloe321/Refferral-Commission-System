# Contributing

This repository is a fictional referral commission sandbox. Contributions should preserve its financial and privacy boundaries: exact minor-unit arithmetic, tenant checks, server-owned transitions, append-only settlement history, and simulated payouts.

## Local setup

1. Install Node.js 24.15.0 (see `.nvmrc`), Corepack, and Docker with Compose.
2. Run `corepack enable` and `pnpm install --frozen-lockfile`.
3. Start the local stack with `docker compose up --build -d`.
4. Open `http://localhost:3000` and use the fictional owner and partner personas.

The application is a sandbox. Do not commit real customer records, contact details, payment credentials, or provider secrets. Keep `SMS_DELIVERY_MODE=preview` and simulated settlement for shared demos.

## Checks before a pull request

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm privacy:check`. Run `pnpm test:e2e` for changes to journeys or rendering. Browser tests restart this Compose project and require Chromium and Docker. `pnpm verify` runs all of these checks.

Add or update tests for domain changes, especially rule precedence, idempotency, authorization, lifecycle transitions, and refunds. Update contracts, migrations, and the architecture notes when API or data behavior changes. Explain in the pull request what changed, how it was checked, and any sandbox limitations.

Do not add production payment, identity, or notification providers without an explicit design and security review. See [README.md](README.md) and [SECURITY.md](SECURITY.md).
