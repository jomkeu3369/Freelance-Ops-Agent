# Read-only MCP pilot

The Spring backend contains a default-disabled, authenticated MCP Streamable HTTP endpoint at
`POST /api/v2/workspaces/{workspaceId}/mcp`. Enable it only in a local or explicitly approved
environment with `APP_MCP_READ_ONLY_ENABLED=true`. No MCP connector, OAuth registration, secret,
public server, or external data transfer is configured by this code.

The endpoint targets [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http):
one JSON-RPC request per POST, JSON response, no protocol session or initialization handshake.
Each request needs a first-party access bearer token, matching `MCP-Protocol-Version` and
`Mcp-Method` headers, an `Mcp-Name` header for calls, both JSON and SSE in `Accept`, and the
required `_meta` fields. `server/discover` advertises the single supported version and tools
capability. The `Origin` header, if present, must exactly match
`APP_MCP_ALLOWED_ORIGINS` (default local UI origins). Production exposure remains disabled.

| Tool | Required workspace permissions | Returned fields |
| --- | --- | --- |
| `list_projects` | `project.read` | Up to 20 project IDs, titles, statuses, currencies, update times |
| `get_project` | `project.read` | One project summary |
| `get_project_progress` | `project.read`, `agent.run` | Latest run ID, status, active department, update time |
| `get_project_result` | `project.read`, `agent.run` | Latest run ID, status, result artifact |

Tool discovery reflects the caller's current workspace permissions. Calls use the existing
tenant-scoped `ProjectService` and `AgentRunGatewayService`; neither client-supplied user IDs nor
workspace IDs from tool arguments are trusted. The result excludes model credential metadata.
Progress/result calls use a dedicated read-only gateway method: it validates membership and
project scope, delegates only `agent.run` and `project.read`, fetches the remote view, and verifies
the returned run ID. It does not synchronize database projections, usage/interruption records,
or analysis events. The regular workspace run endpoint retains its existing synchronization.
Consequently, MCP can return a newer remote status while stored chat history still reflects the
last workspace/reconciliation update. Authorization audit logging remains a security concern
separate from changing project, policy, or run data.
The `get_project_result` artifact can contain user and AI content, so a caller must make an
explicit, authorized request and must not automatically forward it to an external host.

The endpoint currently returns a single JSON response for short reads. It does not implement
subscriptions, SSE tool responses, pagination beyond the first 20 projects, earlier MCP protocol
versions, or external OAuth. Those are separate interoperability and deployment decisions.
