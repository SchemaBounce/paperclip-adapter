# Changelog

## 0.1.1

- Handle the A2A `contextId` conversation-claim errors from core-api's
  `contextId` Contract (core-api docs/A2A_PROTOCOL_SPECIFICATION.md §15):
  - `-32010` (context busy, HTTP 409): another heartbeat's message is still
    being processed on the same conversation. The adapter now reports this
    as a non-fatal failed heartbeat ("the agent is still working on the
    previous turn"), instead of a generic error, and does not retry in a
    loop.
  - `-32011` (conversation unavailable, HTTP 503): a transient
    infrastructure failure while claiming the conversation turn. Reported as
    a `transient_upstream` failure.
  - Both errors keep the stored `a2aContextId` in `sessionParams` so the next
    heartbeat resumes the same conversation instead of starting a new one.
- Fixed `rpc()` to read the JSON-RPC error code and message from the response
  body even when the HTTP status is not 2xx. core-api returns a matching
  non-2xx HTTP status (404, 409, 429, 500, 503, ...) alongside every A2A
  JSON-RPC error, and the client was previously discarding that body and
  reporting a generic "HTTP 409" style message for any such response
  including `-32010` and `-32011`.
- Documented in the README that a rotated service account silently starts a
  fresh conversation on the next heartbeat: the server "chosen behavior" for
  a `contextId` owned by a different caller is to fork silently, never to
  reject, so the adapter cannot detect this case and does not attempt to.

## 0.1.0

- Initial release: run a hosted SchemaBounce agent as a Paperclip worker.
- Exchange a workspace service account credential for a bearer token
  (`client_credentials`).
- Build the heartbeat prompt from the Paperclip wake payload via
  `@paperclipai/adapter-utils`.
- Dispatch the prompt through A2A `message/send`, stream progress over the
  task SSE endpoint, and poll `tasks/get` to a terminal state.
- Return usage, cost, provider, model, and a resumable `a2aContextId` in
  `sessionParams` for the next heartbeat.
