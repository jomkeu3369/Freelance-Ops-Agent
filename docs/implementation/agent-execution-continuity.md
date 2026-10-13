# Agent execution continuity

## Stored state is the source of truth

The Agent acknowledges the current durable status when the same run and exact
request are delivered again. RUNNING, WAITING_FOR_USER and terminal work are not
reported as a new QUEUED run, and are never replayed by that delivery retry.
Already stored matching work can still be acknowledged after its monetary
deadline. New admission and any queued execution still validate their original
funding scope before doing work.

Each department saves its validated output before the next department begins.
The snapshot contains only products actually generated, their open questions,
quotation drafts and source references. RUNNING and WAITING_FOR_USER remain
incomplete states. Failure or cancellation retains the saved snapshot. A later
department's integrity failure remains FAILED and does not make its untrusted
response a saved product.

The UI distinguishes intermediate, partial, stopped and fully completed output.
Saved output cannot hide clarification questions or failure reasons. Only
COMPLETED analysis supplies AI drafts to the quotation editor or exposes the
comparison action. A saved snapshot does not approve a quote or specification.

## Interrupted execution detection

An authenticated status read reconciles RUNNING work using the latest persisted
run.started event and its original maxDurationSeconds. BYOK and legacy platform
monetary deadlines can shorten that window. Completion-v1 still uses its
original per-segment execution limit without inventing wall-date expiry.
The existing limit is followed by a 30-second detection grace for cancellation
and final state persistence; this is not additional execution authorization.

Completion, cancellation, reconciliation and attempt persistence all lock the
same PostgreSQL run row. The first terminal transition wins. An overdue run
becomes FAILED with RUN_EXECUTION_INTERRUPTED and emits one run.failed event.
No credentials are restored and no provider request is replayed. UTC clocks on
the participating services must be synchronized, as for the existing JWT and
monetary deadline checks. Legacy records missing run.started use updated_at as
a conservative fallback.

This state means completion was not confirmed within the bounded execution
window. It is not proof of a process crash or proof that a pending provider
request did, or did not, incur a charge.

## Provider attempts and accounting

Terminal state blocks persistence of a new pre-I/O provider attempt, including
when cancellation or reconciliation happened on another Agent instance. Late
settlement of an already recorded call remains allowed. Scope-exit final
accounting also retains conservative exposure for a reservation made just before
terminal-state admission was rejected. No provider I/O follows final accounting.

Reconciliation never invents usage, drops unknown calls, refunds their bounds,
or marks execution_closed true. Actual scope exit can supply closure evidence.
Unknown provider usage continues to retain conservative exposure under the
existing backend accounting rules. Existing cumulative budget and attempt IDs
remain unchanged.

## Authentication and rollout boundaries

Delegation JWT lifetimes, verification, permissions and issuance are unchanged.
The existing short-lived execution JWT can still expire before a long analysis
finishes. The run reports that failure and preserves prior results; this change
does not renew authentication or enable automatic continuation after a crash.
Platform spending stays disabled unless separately authorized and configured.

The authenticated backend SSE relay must allow task.delegated, task.completed,
task.failed and department.saved before an Agent that publishes these events is
rolled out. It still validates event IDs, run ownership, payload matching,
monotonic cursors and payload limits. Reconciliation occurs before SSE reads,
so a newly generated terminal event reaches the browser before stream closure.
No schema migration or new dependency is required.

## Verification

- Agent tests cover repeated delivery, expired monetary acknowledgement, stored
  intermediate output, exact deadline boundaries, concurrent terminal transitions,
  blocked post-terminal attempts, late accounting and final SSE delivery.
- Real PostgreSQL tests cover restart reconstruction, row-lock concurrency,
  unknown exposure preservation and delayed settlement without provider calls.
- Browser fixtures cover clarification with saved output, stopped-run recovery,
  draft preservation and read-only intermediate results in Korean and English.
- Existing BYOK, platform-budget and completion-v1 regressions remain required.

These fixtures intercept provider traffic. They are not verification of live
provider response quality, actual invoices or an operating deployment.
