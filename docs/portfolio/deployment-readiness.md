# Public sandbox deployment readiness

The Docker Compose stack is a **local demo**. Its default database password, fallback session secrets, open ports, shared demo state, and Mailpit inbox make it unsuitable for direct public exposure. The repository currently has no public deployment URL.

Before publishing a hosted sandbox:

1. Choose a host that supports the Next.js web service, NestJS API, managed PostgreSQL, private service networking, and HTTPS.
2. Set unique session, OTP HMAC, and booking webhook secrets in the host's secret manager. Set `WEB_ORIGIN` and API proxy destinations to the actual HTTPS origins.
3. Keep `APP_MODE=sandbox`, `SMS_DELIVERY_MODE=preview`, and `EMAIL_DELIVERY_MODE=disabled` unless a private test inbox is available. Never expose Mailpit or PostgreSQL to the public internet.
4. Use fictional seed data only. Treat the reset endpoint and shared demo database as a concurrency concern: either isolate visitor state or protect resets with an operator-controlled reset schedule before inviting public traffic.
5. Put rate limits and resource quotas on session creation, booking events, claims, and reset. Monitor service health, event failures, outbox failures, and database size.
6. Run the CI checks, migrate the managed database, verify the browser journey on the hosted URL, and publish screenshots that show the sandbox and simulated-payment labels.

The application must continue to say that money movement is simulated. Real identity, payment reconciliation, tax, KYC, backups, monitoring, and legal review are separate production work.
