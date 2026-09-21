# CLAUDE.md - SchemaBounce Paperclip Adapter

Public npm package `@schemabounce/paperclip-adapter`. It lets a Paperclip
company hire a hosted SchemaBounce agent. It is a thin translator over the
SchemaBounce Hosted Agent Worker contract (dec-055): a token exchange, one A2A
JSON-RPC call, and stream forwarding. All behavior that matters (budgets,
approvals, ownership, conversation continuity, cost) lives in core-api.

## Branching (same rules as core-api and frontend)

- **Commit directly to `development`.** No feature branches. No pull requests
  into `development`.
- **`main` is the release branch.** The only pull request in this repo is
  `development` to `main`, opened when a version is ready to publish. An agent
  never commits, pushes, or merges to `main`, and never opens that pull request
  unless the owner asks for it.
- Never force-push. Never `git stash`, `git add .` or `git add -A`. Stage and
  commit by explicit path: `git commit -F <message file> -- <paths>`.
- Always name the repository when reporting branch or release state, for
  example "pushed to paperclip-adapter `development`".
- Do not turn on GitHub's "automatically delete head branches" setting. The
  head of every release pull request is `development`, and that setting would
  delete it on merge.

## Releasing

1. On `development`: bump `version` in `package.json` and `package-lock.json`
   (`npm version <x.y.z> --no-git-tag-version`) and add the `CHANGELOG.md`
   entry.
2. The owner promotes `development` to `main` through a pull request.
3. From `main`, run the **Publish to npm** workflow: first as a dry run, then
   with the dry run box cleared. It needs a reviewer approval in the
   `npm-publish` environment.

Publishing uses npm trusted publishing (OIDC). There is no npm token anywhere,
and none may be added: npm removes direct publishing from 2FA-bypass tokens in
January 2027. The workflow refuses any ref other than `main` and any version
already on npm. A version number on npm is permanent.

## Workflows

Workflows trigger only on `push` to `main` and `workflow_dispatch`. No
`pull_request` triggers, nothing on `development`. Every job sets
`timeout-minutes`. Actions are pinned to commit hashes.

## Before every commit

There is no pre-commit hook in this repo, so run the gate by hand:

```bash
npm run typecheck && npm run build && npm test
```

All three must pass. A release commit also runs
`npm publish --dry-run --provenance=false` and checks the file list.

## Security

- This repository is public. Never commit a secret, a real workspace id, a
  service account id, an internal hostname, or anything from a private
  SchemaBounce repo.
- The adapter must never log the client id, client secret, or access token.
  Every new log or error path gets a test asserting that, in the style of the
  existing secret-leak assertions.
- The server's JSON-RPC errors arrive with non-2xx HTTP statuses. Always parse
  the error body before treating a response as a transport failure.
- On a busy (-32010) or unavailable (-32011) error, keep the stored
  `a2aContextId`. Dropping it silently ends the conversation.

## Contract source of truth

The server contract is `docs/A2A_PROTOCOL_SPECIFICATION.md` section 15 in
SchemaBounce/core-api. When the README and that spec disagree, the spec wins
and the README is the bug. Accepted decisions that bind this package: dec-055
(one inbound contract, public adapters), dec-056 (service account credentials,
caller-owned conversations), dec-062 (API keys are not accepted on the A2A
endpoint).

## Copy rules

Short declarative sentences. No em dashes. No hype verbs (seamless, unlock,
leverage, streamline, empower, supercharge).

## Line endings

`.gitattributes` forces LF. If `git status` shows every file modified with no
real diff (`git diff --ignore-cr-at-eol --numstat` prints nothing), the
checkout was made with CRLF conversion. Set `git config core.autocrlf false`
in that clone and check the files out again, or re-clone. Never commit a
whole-file line ending flip.
