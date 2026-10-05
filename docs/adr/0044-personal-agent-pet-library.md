# ADR-0044: Personal agent pet library with untrusted preference data

- Status: Proposed; implementation checkpoint, not release approval
- Date: 2026-10-05
- Supplements ADR-0030 and ADR-0032

The three quotation scenarios are not a limit of three user-owned pets. Personal pets need stable IDs, separate active/archive lifecycle and one selected profile for the next run. Spring owns these records and tenant authorization. V44 introduces a separate collection without rewriting legacy quotation profiles or saved run requests.

The initial prompt flow is a free deterministic preview over existing SVG appearance assets. Arbitrary style and task preferences remain bounded, reviewable user data, including an ordered correction history and separately labelled fields. The preview must explicitly disclose limited interpretation. It must never claim that a paid model generated or fully understood the result.

Selection contributes one snapshot to the existing run, not another agent loop. Python receives the free-form content under an untrusted preference-data field. A fixed instruction limits application to communication style and current task emphasis; server permissions, approval, tools, model selection, credentials and budgets remain independent. The separate skill catalog can consume the AUTO selection hint after integration; no duplicate catalog is created here.

Creation retries use stable pet/mutation IDs, expected revisions and transaction-serialized owner-scoped limits. Archive clears selection, restore requires a subsequent explicit selection, and deletion requires an archived profile. Existing run snapshots remain unchanged. Cross-workspace and cross-user access is denied even to another owner in the same workspace.

Standalone paid generation stays unavailable until durable reservation, reconciliation, idempotent settlement, cancellation and retry semantics are integrated with the platform cost ledger. The existing spend guard is preserved. See [the feature contract](../frontend/CUSTOM_AGENT_PETS.md) for the required ledger states and current limits.

This checkpoint is not fully verified. Further builds, browser tests and database integration must run in the cloud environment, following the user's instruction to stop heavy work on their laptop. No production migration or deployment is authorized.
