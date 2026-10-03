# Verified email and operational notices: release-gated foundation

This change adds code and disposable test fixtures. It does not connect a mail provider, send real email, assign an administrator, migrate a running database, publish policy text, or deploy the service.

## Release gates

- `APP_AUTH_EMAIL_VERIFICATION_REQUIRED=false` by default. Existing signup behavior is retained until an approved rollout. When true, registration returns a generic `EmailVerificationRequired` response with no account identifier or session. Login/refresh reject accounts that still require verification. Pending signup stores no usable password; the owner sets a fresh password at confirmation, so a preregistrant cannot choose the credential activated by someone else. Legacy ownership confirmation never changes an existing password.
- The only production transport shipped is `DisabledMailConfiguration`. It cannot send and never reports acceptance. Setting the verification flag without implementing a ready transport causes a uniform `503 EMAIL_VERIFICATION_UNAVAILABLE` before a new account is created. A configuration flag alone cannot install SMTP or another provider.
- `APP_NOTICES_DISPATCH_ENABLED=false` is a second, independent gate. Connecting mail for verification does not enable operational campaign dispatch. No scheduler is installed, and the UI has no dispatch button.
- `NOTICES_ADMIN` is an independent platform capability. Workspace OWNER/ADMIN and `FREE_USAGE_ADMIN` do not grant it. Migrations create no grants and do not expand existing grants. Grant assignment, provider credentials, rollout, actual mail, and policy publication require separate operational approval.
- Full Gradle and PostgreSQL integration checks must pass in an environment with the required dependencies and Docker before release. Browser mocks do not establish real delivery or database correctness.

## Email verification

`POST /api/v2/auth/email-verification/request {email}` returns the same accepted response for unknown, verified, cooldown-limited, daily-limited, and eligible addresses when transport is ready. A disabled transport uniformly returns 503. It never returns a token, user ID, or proof of an address existing. Signup duplicates use `INSERT ... ON CONFLICT DO NOTHING` to preserve the generic response under concurrent registration.

An eligible request generates 32 cryptographically random bytes. Only SHA-256 and expiry are persisted on that account. Replacement invalidates the previous link. Consumption is one conditional database update, requires an active account and unexpired link, and clears the hash. Concurrent/replayed consumption fails. Defaults are 30-minute expiry, 60-second cooldown, and 5 requests per UTC day; limits are validated and the account row serializes concurrent resend requests. The existing auth IP limiter covers registration, resend, and confirmation. That in-memory IP limiter is per application instance; multi-replica deployments still need an approved shared edge limit before public rollout. No arbitrary recipient list or batch-verification endpoint exists.

Raw links are transient and handed to a bounded two-worker/100-task in-memory executor only after the transaction commits. Provider latency is decoupled from account-eligibility responses; overload fails closed and requires an explicit later resend. They are not in database message bodies, API responses, logs, or debug endpoints. The URL uses a fragment; the frontend captures it in memory, removes it from history, and waits for the user's explicit confirmation. GET/link scanners cannot consume verification. Provider errors must not contain raw link/recipient details in logs. Verification transport failures are not silently treated as verified; users can explicitly request a replacement after cooldown. This first release does not have a durable verification-mail retry queue.

`APP_PUBLIC_ORIGIN` must be an exact HTTPS origin; local development permits `http://localhost:<port>`. Verification requires no automatic login, and confirming the link sends the user back to login.

### Existing accounts

V38 adds `email_verification_required=false` and leaves `email_verified_at` NULL on existing accounts. This preserves access without falsely claiming ownership was proven. Existing unverified accounts are excluded from operational email snapshots. They can verify through the same request/confirm flow; neither resend nor a failed verification changes their login eligibility. No existing-user verification or consent backfill is performed. Requiring verification for all existing accounts is a separate rollout and is not implemented by this migration.

## Notice and legal-version registry

- `/notices` reads only due, published `OPERATIONAL` notices; drafts, reviewed/future notices, and legal metadata are never returned by the public endpoint.
- `/admin/notices` can create immutable version records, review them with an optimistic revision check, and explicitly confirm operational publication. A future `publishAt` schedules public visibility through the read predicate. The effective date must not precede publication.
- `TERMS_VERSION` and `PRIVACY_VERSION` accept metadata only. Their body must be blank and publication is blocked in both service and database. No private policy draft, legal body, fake published version, or invented consent is seeded.
- A new notice is required for changed content. Published records cannot be edited. The registry does not implement legal notice-period calculations or claim legal approval. Operators must obtain the actual policy and timing review before a separate legal-publication release.
- A notice or delivery is not consent. There is no implicit acceptance, new consent record, or retrospective acceptance backfill. A separate consent flow must be specified if needed.

## Operational campaigns

1. Prepare from a currently public operational notice. The server takes a bounded snapshot of active, actually verified accounts, including the current email. It freezes title/body/version, SHA-256 content hash, audience hash, and count. The current maximum is 200 recipients by default (configurable from 1 through 5,000); exceeding it rejects the whole request, never silently truncates. At most 10 campaigns per actor can be prepared in 24 hours.
2. Preview the exact snapshot. Human review must confirm the content is a necessary service/operational notice. There is no promotional opt-in model or marketing-send path in this release; do not put coupons, sales, or promotional material into these campaigns.
3. Test only to the acting administrator's own verified email. No request accepts a test recipient. Tests are limited to five per campaign and a 60-second cooldown. `BLOCKED_TRANSPORT` is not a sent message. `ACCEPTED` means only provider acceptance, never delivery or reading.
4. Explicitly confirm the exact content hash, audience hash/count, and `QUEUE_OPERATIONAL_NOTICE`. The same administrator must have an accepted self-test. A draft expires after 24 hours and must be prepared again. Identical confirmation is idempotent; changed content/audience input is rejected. Queueing itself sends nothing.
5. A separately enabled one-recipient dispatcher uses stable `notice-delivery:<id>` idempotency keys. Every message has one recipient. No To/CC/BCC list exposes other users. The dispatcher rechecks the account is active, verified, and still owns the snapshotted address; otherwise it records `SUPPRESSED`.
6. Cancellation stops PREPARED/QUEUED/RETRY rows. It does not recall messages already accepted by a provider. Campaign/row locking orders cancellation against dispatch.

Delivery states distinguish ACCEPTED, RETRY, FAILED, UNKNOWN, BOUNCED, CANCELLED, and SUPPRESSED. Explicit retryable failures have bounded exponential backoff and a maximum of three attempts. An exception/unknown outcome is terminal and is never blindly retried. Provider acceptance is terminal for submission; this foundation has no delivery/open-tracking pixel or webhook integration. Any future bounce webhook must validate its signature and cannot invent consent.

The shipped adapter performs no network I/O. A future provider adapter must document and test stable idempotency across process/database crashes and timeouts before enabling dispatch; otherwise a crash after provider acceptance but before database commit could duplicate a message. Provider requests need bounded timeouts. Provider authentication, signed webhook handling, rate/quotas, address/sender ownership, retention/deletion, and monitoring are rollout requirements, not configured capabilities.

## Audit and privacy

Administrator create/review/publish/test/confirm/cancel/dispatch actions are appended to an immutable audit table. Delivery rows hold per-recipient state, attempt count, sanitized result enum, and retry time. The dashboard exposes aggregate states, hashes, and counts; it does not export recipient addresses or token contents. Transport exception text is never stored or logged. Snapshot content and recipient identity are immutable at the database layer. Deleting an account cascades its recipient rows; a changed pre-approval audience cannot pass the stored hash/count check.

No production provider, real recipient, policy draft, or credential belongs in fixtures. All fixtures use `.invalid` addresses and an in-memory transport. Real mail confirmation and retention policy still need operator review before activation.

## Verification commands

- `cd frontend && npm run ci:check && npm run build`
- `cd frontend && npm run test:ui -- <verification/notice fixture files>` (route-mocked local UI only)
- `cd backend && ./gradlew test` (includes `VerifiedNoticesPostgresTest`; Docker + pgvector PostgreSQL required)

Relevant backend fixtures cover sessionless pending signup, duplicate-registration equivalence, login gating, hash-only token persistence, expiry, replay, resend invalidation/cooldown/daily cap, concurrent consume, disabled transport, preserved/unverified legacy accounts, distinct platform admin capability, public draft/legal/future exclusion, immutable snapshots, confirmation integrity/idempotency, own-address self-test, cancellation, submission idempotency, and suppressed/unknown delivery outcomes. The tests are evidence only when executed successfully, not merely because they exist.
