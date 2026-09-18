# Privacy boundary

This repository is an independently authored clean-room remodel of common referral commission patterns. It demonstrates portable domain behavior without carrying over private company code, names, identifiers, customer data, assets, credentials, copy, or configuration.

The sample business, people, services, contacts, IDs, transactions, and screenshots are fictional. The default experience runs locally.

## What “clean-room remodel” means here

The project reimplements general business ideas:

- referral-code attribution;
- rule-based line-item commission calculation;
- explicit pending, eligible, held, reserved, settled, voided, and reversed states;
- partner-authorized claims;
- simulated payout and refund recovery;
- notification delivery through a transactional outbox;
- append-only audit explanations.

It does not reproduce a private repository's source, schema, endpoint names, UI, branding, imagery, messages, internal identifiers, credentials, or customer records. The codebase uses a new Northstar Home Services scenario, new stable UUIDs, new copy, a new work-order visual language, and independently designed APIs and tests.

## Fictional data policy

Committed fixtures use:

- fictional names and business records;
- IANA-reserved example domains such as `example.com` and `example.invalid`;
- North American `555-01xx` fictional phone numbers;
- deterministic UUIDs with no relationship to another system;
- integer sample money in one organization currency;
- a public referral URL under `https://referrals.example.invalid` with no query, fragment, credentials, email, phone, cookie, or session value.

The QR code encodes only the public fictional referral URL and code.

## Local private identifier denylist

The repository intentionally does not contain private company or product terms. A developer who knows those terms can place them in:

```text
.privacy-denylist.local
```

Use one case-insensitive term per line. Blank lines and lines beginning with `#` are ignored. The file is in `.gitignore`; never stage it. Scanner output reports only that a locally denied identifier was found, not the sensitive term itself.

The scanner remains useful in a public clone without this optional local file. Its neutral checks still run.

## Repository privacy scanner

Run:

```bash
pnpm privacy:check
```

The command first runs committed synthetic self-tests, then scans tracked and non-ignored pending files. The synthetic fixtures are excluded from the repository pass and contain no real private identifiers.

Rules detect:

| Rule              | What fails                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Local denylist    | A term from `.privacy-denylist.local`, case-insensitive                                                                 |
| Secret assignment | A likely literal API key, token, secret, password, or credential that is not an obvious test or development placeholder |
| UniSMS example    | A committed environment or documentation example whose `UNISMS_API_KEY` is not `replace_me`                             |
| Fixture email     | An email in a seed, fixture, or mock that does not use a reserved example domain                                        |
| Fixture phone     | An E.164 literal in a seed, fixture, or mock outside the reserved `+1...555-01xx` range                                 |
| Binary location   | A binary extension or NUL-containing file outside `docs/screenshots/`                                                   |

`docs/screenshots/` is the only documented public binary asset directory. The two screenshots there are generated from the fictional sandbox by deterministic Playwright tests.

The scanner is a release backstop, not a secret manager or a substitute for history scanning. A production repository should also use provider-side secret detection, protected CI variables, review policy, and credential rotation.

## Session and reset boundary

Demo persona selection is available only when `APP_MODE=sandbox`. Outside sandbox mode, `/demo/*` responds as not found.

The API signs the session payload with HMAC and stores it in an HTTP-only, same-site cookie. The payload contains actor, organization, role, expiry, and `sandboxVersion`. Every protected request reloads the eligible actor and compares those values with the database.

Reset is owner-only and requires the exact body:

```json
{ "confirmation": "RESET SANDBOX" }
```

Under a tenant advisory lock, reset deletes only the deterministic fictional organization, inserts the canonical seed in the same transaction, increments `sandboxVersion`, and issues a new owner session. Older cookies fail version comparison. A failed seed rolls the transaction back.

This reset mechanism is intentionally not a general administration endpoint.

## Authorization and data scoping

- Owners may inspect organization-scoped programs, partners, earnings, claims, conversions, and audit events.
- Partners may inspect only their own partner detail, earnings, claims, referral code, and ledger entries.
- Only partners create OTP challenges and claims.
- Only owners run payout simulation, retry failed simulated payouts, manage programs and partners, hold or void earnings, and issue refunds.
- Organization filters and composite foreign keys apply even when a caller presents a valid UUID from elsewhere.
- Owner claim read models expose linked OTP audit metadata, not the OTP code.

The owner and partner workspaces are discriminated runtime contracts. A persona switch rotates the signed session and reloads workspace and guide data before rendering the new role, which avoids showing stale records from the previous role.

## OTP and notification privacy

- OTP generation uses a cryptographically secure six-digit random value.
- The challenge stores a challenge-bound HMAC digest, not plaintext.
- Preview content is returned only to the current sandbox browser and displayed in a right-side drawer.
- Provider and email modes do not expose the code in API responses.
- Recipient addresses are masked in UI-facing state.
- Provider credentials remain server-side.
- The outbox clears message content and masks recipients before each external attempt. A known retryable pre-acceptance failure restores plaintext only while the row awaits its next bounded retry; ambiguous and terminal outcomes remain redacted.
- Audit metadata does not store OTP codes, authorization headers, provider secrets, email addresses, or phone numbers.

See [Notification delivery](notification-delivery.md) for exact mode and redaction behavior.

## Financial privacy and integrity

The sandbox contains simulated money only, but it uses production-shaped safety boundaries:

- exact integer minor units and decimal-string JSON;
- immutable earning rule snapshots;
- tenant-scoped idempotency and row locks;
- actor or system provenance on audit events;
- append-only payout and reversal ledger entries;
- no deletion or rewriting of a settled payout after refund;
- atomic claim, settlement, failure, retry, refund, and reset operations.

No bank account, card, tax identifier, identity document, payout credential, or real payment token is collected or stored.

## Public assets and screenshots

The committed screenshots live under `docs/screenshots/` and are generated by the browser suite at fixed viewports. Timestamps and animations are controlled for repeatability. Playwright artifacts such as `test-results/`, `playwright-report/`, and `blob-report/` are ignored and must not be committed.

Do not add copied logos, screenshots, fonts, exports, or other binaries from a private system. Independently created public documentation assets belong only in the documented screenshot directory unless this policy and scanner are intentionally updated together.

## Production limitations

The sandbox cookie is not production authentication. Persona IDs are deterministic. Cookies set `secure: false` for localhost. The project does not implement identity proofing, MFA recovery, KYC, tax handling, payout accounts, compliance, fraud operations, backup policy, secret rotation, production deployment, or incident response.

Before adapting the code to real people or money:

1. replace demo sessions with an audited identity system;
2. define tenant provisioning and authorization policy;
3. classify and minimize personal data;
4. replace fictional contacts and local preview behavior deliberately;
5. store secrets in a managed secret service;
6. add retention, deletion, access, backup, and incident procedures;
7. review payout and recovery accounting with legal and financial specialists;
8. perform a threat model and independent security assessment.

## Related documentation

- [Project overview and local tour](../../README.md)
- [Domain lifecycle and recovery ledger](domain-lifecycle.md)
- [Notification delivery](notification-delivery.md)
