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

## Conversation continuity

Every heartbeat returns `sessionParams.a2aContextId`, which Paperclip stores
and passes back on the next heartbeat as `ctx.runtime.sessionParams`. The
adapter sends that value back to SchemaBounce as the message's `contextId`,
so a wake, its follow-ups, and its recoveries stay in one hosted-agent
conversation instead of starting over each time.

**What continuity is scoped to.** A `contextId` is bound to the caller that
first used it: the SchemaBounce workspace service account (`clientId`)
configured for this adapter, together with the target agent. Two different
service accounts, or two different agents, never share a conversation even if
they are given the same stored `contextId`. If you rotate the service account
credential, the next heartbeat starts a fresh conversation with no memory of
the old one. The server does this silently: it does not return an error and
the adapter cannot detect it, because SchemaBounce's `message/send` never
rejects a reused `contextId` from a different caller; it forks to a new
conversation and returns success. Treat rotating the service account the same
as starting the Paperclip employee over.

**What a busy response means.** SchemaBounce processes one turn per
conversation at a time. If a heartbeat fires while the previous turn is still
running, SchemaBounce refuses the new message instead of queuing it silently.
The adapter reports that heartbeat as failed, with a message saying the agent
is still working on the previous turn, and keeps the stored `a2aContextId`
unchanged. It does not retry in a loop. The next heartbeat, on its normal
schedule, sends the same `contextId` and continues the conversation.

**A transient coordination failure also keeps the context.** If SchemaBounce
cannot coordinate the conversation turn (for example, its own database being
momentarily unreachable), that one heartbeat also fails and also keeps the
stored `a2aContextId`, so the next heartbeat can still resume.

**The continuity signal.** When a heartbeat sends a stored `a2aContextId`,
SchemaBounce reports back, in the adapter's run log, what memory the agent
actually got for that turn:

- `resumed`: the agent's full working state from the prior turn was
  restored, the same way a normal SchemaBounce chat session resumes.
- `history`: no working state was available, but the conversation's saved
  transcript was loaded, so the agent sees the prior messages, not its prior
  in-progress work.
- `none`: the agent started the turn with no memory of any earlier one. This
  is normal on the first turn of a new conversation. On a later turn, it
  means neither the working state nor the transcript was available.

This value describes only the turn that was just dispatched. It is not
repeated on later status checks of the same task, so there is nothing to poll
for it, and an older SchemaBounce deployment omits it entirely. When a
heartbeat sends a stored `a2aContextId` and gets `none` back, the adapter
writes one plain-language line to the run's log saying this turn ran without
memory of earlier turns. That line is informational: it does not fail the
heartbeat by itself, and the stored `a2aContextId` is never dropped because
of it.

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

The package is implemented against `@paperclipai/adapter-utils` `2026.831.1` and the SchemaBounce Hosted Agent Worker contract. It is on npm as `@schemabounce/paperclip-adapter`.

## Releasing

All work lands on `development`. `main` is the release branch.

1. On `development`, bump `version` in `package.json` and add the `CHANGELOG.md` entry.
2. Open a pull request from `development` to `main` and merge it. That is the only pull request this repository uses.
3. From `main`, run the **Publish to npm** workflow from the Actions tab. It defaults to a dry run that builds, tests, and packs without publishing.
4. Run it again with the dry run box cleared to publish. The workflow refuses any ref other than `main` and any version already on npm.

The workflow uses npm trusted publishing. GitHub proves the workflow's identity to npm over OIDC, so there is no token and no repository secret. Packages publish as public, and npm attaches a provenance attestation on its own.

### One-time setup

Version `0.1.0` was published by hand, because npm cannot register a trusted publisher for a package that does not exist yet. Two settings remain, both done once.

On GitHub, under the repository's Settings, Environments:

1. Create an environment named `npm-publish`.
2. Add required reviewers, and limit deployment branches to `main`.

On npmjs.com, under the package's Settings:

1. Add a trusted publisher: GitHub Actions, organization `SchemaBounce`, repository `paperclip-adapter`, workflow filename `publish.yml`, environment `npm-publish`.
2. Set publishing access to "Require two-factor authentication and disallow tokens".

npm then accepts a publish only from that workflow, in that environment, after a reviewer approves the run. A leaked token or a workflow on another branch cannot publish.

Every later version goes through the workflow.
