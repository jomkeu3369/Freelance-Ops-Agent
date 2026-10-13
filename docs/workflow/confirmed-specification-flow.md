# Confirmed specification flow

The implementation adds a cost-free, explicit boundary after an analysis result is confirmed.

1. Select public opinions and compose a deterministic draft.
2. Review, edit, and explicitly confirm the result.
3. Generate a specification from that server-owned confirmed result ID.
4. Save any specification edits as a new immutable revision.
5. Explicitly confirm the saved specification.
6. Download its actual PDF file and use only its confirmed text as keyword reference material for later analyses of the same project.

The original input messages, selected public opinion snapshots, initial composition,
user edits, source result revision/hash, and specification revisions remain separately
traceable. Unselected opinions and discarded drafts are never written as reusable
truth. Reformatting is lossless chunking with exact offsets and a reconstruction check;
it does not invoke AI, embed text, infer new facts, or silently change confirmed content.

## API and revision rules

All routes are workspace/project scoped under
`/api/v2/workspaces/{workspaceId}/projects/{projectId}/specifications`.

- GET lists up to 50 lightweight revision summaries, and GET `/{id}` reads an exact revision.
- POST creates a draft using only `decisionId` and `requestId`.
- POST `/{id}/revisions` takes a request ID, expected content hash, title, and edited body.
- POST `/{id}/confirm` requires the exact expected hash and `CONFIRM_SPECIFICATION`.
- GET `/{id}/pdf` returns `application/pdf` bytes with an attachment filename.

Creation and editing have transactional request-ID replay records. Reusing an ID
with another operation is a conflict. Reopening generation does not discard existing
edits. Confirm retries return the same confirmed revision, without a second document.
Only the latest specification may be edited/confirmed. A historical confirmed
revision stays readable and downloadable after newer revisions or source changes.

Read access requires `project.read` and `document.read`; mutations also require
`project.write` and `document.write`. Cross-workspace/project IDs remain not found.
Source freshness includes the project revision, exact immutable root message IDs,
and the latest confirmed result, not just a project timestamp. Confirmation locks
the project then workspace before the source check and keyword write. Source
corrections and newer result confirmations invalidate older reusable specification
memory while preserving the original confirmed artifact and old PDF links.

## PDF and resource boundaries

This work-branch snapshot excludes the TTF binary while its publication awaits
approval. Real Korean PDF rendering has been checked locally with that asset;
remote rendering and complete connected backend acceptance are still pending.
Missing renderer resources return HTTP 503 without changing confirmed content.
No runtime asset download or substitute-font path is enabled.

PDFBox 3.0.8 generates a real, selectable-text PDF locally. The bundled static
Pretendard Korean font retains its OFL license. HTML-like text is literal, never
executed. Unsupported characters are shown as explicit codepoint markers. Revision,
content SHA-256, confirmation timestamp, and page numbers are included, and repeated
exports of the same revision produce identical bytes.

Specification content is at most 100,000 UTF-16 code units and 4,000 logical line
breaks (CRLF counts once, with the original bytes preserved). Actual PDFs are capped
at 100 pages. Oversized output fails explicitly;
no partial PDF or silently truncated text is delivered. The UI reports that a
browser download started, not that a file was definitely saved to the user's disk.

## Costs and future reuse

Confirmation is `KEYWORD_ONLY` and makes no paid embedding/summary call. The legacy
manual RAPTOR indexing endpoint preserves its route and authorization checks but
fails closed with `RAPTOR_COST_CONTROL_UNSUPPORTED` until an explicit bounded
reservation/settlement contract exists. A spend-enabled flag alone is insufficient.

Cross-project reuse is not enabled. A future implementation should use explicit
historical-reference selection (default off), source project/revision IDs, a bounded
run-level allowlist, workspace and source-project authorization, and a corresponding
Agent delegation/retrieval contract. Past examples must remain separate from current
project requirements and require review for relevance and confidential information.
It must not automatically broaden document sharing or transmit sensitive client
information to another project or an AI provider.

No deployment, production database migration, main merge, or paid provider call is
performed by this implementation.
