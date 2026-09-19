# SchemaBounce Paperclip Adapter

`@schemabounce/paperclip-adapter` runs a hosted SchemaBounce agent when Paperclip fires a heartbeat. It translates Paperclip execution context into SchemaBounce's A2A worker contract, streams progress into the Paperclip transcript, and returns usage, cost, provider, model, and resumable A2A context.

## Configuration

Create a workspace service account in SchemaBounce and limit it to the agent this Paperclip employee will use. Configure the adapter with:

```json
{
  "apiUrl": "https://api.schemabounce.com",
  "workspaceId": "ws_example",
  "agentId": "agent_example",
  "clientId": "svc_example",
  "clientSecret": "stored through Paperclip's secret field",
  "timeoutSec": 900
}
```

The client secret is declared as a Paperclip managed-secret field. Remote API URLs must use HTTPS. `http://localhost` and `http://127.0.0.1` are accepted for local development.

## Local installation

Build the package, then register its directory through Paperclip's adapter manager:

```sh
npm install
npm run build

curl -X POST http://localhost:3100/api/adapters/install \
  -H "Authorization: Bearer <paperclip-token>" \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/absolute/path/to/paperclip-adapter","isLocalPath":true}'
```

Verified against Paperclip CLI/server `2026.916.0`: the install route is
`POST /api/adapters/install`, and the body takes `packageName` (required
string, the package name or local path) plus `isLocalPath: true` for a local
directory. A body shaped `{"localPath": "..."}` posted to `/api/adapters`
returns `400 packageName is required and must be a string.`

The adapter type is `schemabounce`.

## Runtime flow

1. Exchange the service-account credential at `/api/v1/oauth/token` (`client_credentials`, Basic auth).
2. Build the heartbeat prompt with `@paperclipai/adapter-utils`' own `renderPaperclipWakePrompt`, so recovery causes, plan-review threads, and comment batches render exactly as Paperclip's built-in adapters render them.
3. Send it through A2A `message/send`, tagging the run with `metadata.externalRef = {source: "paperclip", externalId: <issue id>}`, `wakeReason`, and `commentId` read from the same wake payload.
4. Stream the task over the authenticated task SSE endpoint (`GET .../tasks/:taskId/stream`), forwarding every frame to Paperclip's transcript via `onLog`.
5. On a terminal state, read the task through `tasks/get` and return its usage, cost, provider, model, and a resumable `sessionParams.a2aContextId` to Paperclip.

The adapter never logs the client ID, client secret, or access token.

## Calling back into Paperclip

The adapter only gets a SchemaBounce agent INTO a Paperclip heartbeat. For the
agent to act on the issue (check it out, read its context, comment, mark it
done), connect the curated **Paperclip MCP** server to the same SchemaBounce
agent: add an MCP connection referencing `tools/paperclip` (the
`@paperclipai/mcp-server` package, run by the mcp-gateway as an `npx` stdio
child) with `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`,
and `PAPERCLIP_AGENT_ID`. The hosted worker runtime injects a per-run
`PAPERCLIP_RUN_ID` into that MCP connection automatically
(`openclaw-runtime/internal/executor/paperclip_runtime_env.go`), so every
mutating call the agent makes is attributable to the run that triggered it.
Never set `PAPERCLIP_RUN_ID` by hand.

## Development status

The package is implemented against `@paperclipai/adapter-utils` `2026.831.1` and the SchemaBounce Hosted Agent Worker contract. Publishing to npm and creating the public GitHub repository are separate release actions.
