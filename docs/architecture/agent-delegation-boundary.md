# Internal delegation and a future A2A adapter

The current production executor dispatches bounded local specialist work through
`agent/src/runtime/internal_delegation.py`. A task ID and durable
`task.delegated`, `task.completed`, or `task.failed` events describe the actual
department call. The public Spring run API projects these events for the UI.
This is **internal orchestration**, not an A2A protocol implementation. No
Agent Card, external A2A client/server, protocol task endpoint, or external
agent data transfer is enabled.

Keep the internal task identity and result contract independent of transport.
An eventual A2A adapter should map an authorized, explicitly scoped local task
to A2A message/task/status/artifact objects at the boundary, then map responses
back to the existing run journal. It must preserve the workspace and project
scope, delegated permissions, budget, cancellation, idempotency key, event
cursor, and user approval state. Its credentials and endpoint allowlist belong
to the authenticated Spring integration boundary; the model must not choose an
arbitrary destination or receive raw credentials. A remote failure must leave
the local run's terminal state and audit trail accurate.

Before enabling that adapter, add fixture based protocol conformance tests for
discovery, version negotiation, streaming/reconnect, artifacts, cancellation,
authorization failure, and replay. Choose the A2A SDK and exact wire version
against the then-current [official specification](https://a2a-protocol.org/latest/specification/).
This phase does not publish an Agent Card or open an external listener.
