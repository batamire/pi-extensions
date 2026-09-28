# `pkg/pi-recap` — installable mirror of `@tifan/pi-recap`

This branch's **root is the package**, so pi can install it:

```bash
pi install git:github.com/batamire/pi-extensions@pkg/pi-recap
```

It exists because pi resolves a package root and cannot install from a repo
subdirectory — `packages/pi-recap` works, the monorepo root does not
(`Cannot find module`). The branch mirrors exactly what upstream publishes
(the package's `files` field: `src/**/*.ts`, `README.md`, `LICENSE`), so
`tsconfig.json`, `CHANGELOG.md`, and `assets/` are intentionally absent.
`LICENSE` is materialized because upstream symlinks it to the monorepo root.

## Self-healing

`.github/workflows/sync-pi-recap.yml` on `master` runs daily. It checks upstream's
`packages/pi-recap/src/index.ts` and:

- **upstream does not carry the fix** → does nothing, so this branch keeps the patch below.
- **upstream carries the fix** (`x-opencode-session` present) → replaces these
  files with upstream's verbatim and removes this notice.

So the patch is held only while upstream lacks it, and the branch becomes a plain
mirror afterwards. Nothing to watch, nothing to switch back.

Updates reach a local install via `pi update --extensions` (or `--all`), which
fetches this branch and hard-resets the checkout to its head.

## The patch

Contents are `@tifan/pi-recap` 0.4.7 plus
[copilot review][review]'d changes submitted as
[upstream PR #43](https://github.com/tifandotme/pi-extensions/pull/43).

`/recap` failed with a bare `Error: Recap generation failed.` because
`ctx.modelRegistry.complete()` does not attach OpenCode's session headers, and
opencode.ai-backed providers reject requests without them:

```
400: {"type":"MissingSessionID","message":"Request is missing x-opencode-session
and cannot be routed efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it"}
```

pi adds `x-opencode-session` / `x-opencode-client` on its own agent path, but
`modelRegistry.complete()` → `ModelRuntime.prepareRequest()` builds headers only
from the resolved credential plus `options.headers`. Passing `options.sessionId`
does not help — it is not read on that path.

Four changes:

1. **Session headers** — `opencodeSessionHeaders()` sends
   `{"x-opencode-session": <id>, "x-opencode-client": "pi"}` for `opencode`,
   `opencode-go`, or an `opencode.ai` baseUrl host, mirroring pi's own rule. The
   id comes from the typed `ctx.sessionManager.getSessionId()`.
2. **Timeout** — `RECAP_REQUEST_TIMEOUT_MS` raised `4_000` → `30_000`. Trivial
   requests measured 1.3–8.2s, so the old budget was regularly exceeded.
3. **Error surfacing** — report `response.errorMessage` and the caught error's
   message instead of a generic failure.
4. **Abort/supersession gating** — the `catch` notified unconditionally, so an
   aborted run produced a stale `This operation was aborted` in the new context.
   Guarded on `runId`/`sessionActive` plus this run's own
   `abortController.signal.aborted`, because a second generation aborts an
   in-flight run without bumping `runId`.

## Verification

| Test | Result |
| --- | --- |
| `complete()` as upstream calls it | `stopReason=error`, `400 MissingSessionID` |
| `complete()` + explicit session headers | `stopReason=stop`, 3102ms, valid reply |
| `openrouter/anthropic/claude-haiku-4.5`, no headers | `stopReason=stop`, 1340ms |
| `bun run typecheck` / `lint` / `format:check` on the PR branch | pass |

Interactive `/recap` only exercises inside the TUI: `generateRecap()` returns
early when `!ctx.hasUI`.

Related upstream pi issues, all closed but still reproducing on 0.87.1:
earendil-works/pi#9290 (`complete()` path), earendil-works/pi#10053 (`stream()`).

[review]: https://github.com/tifandotme/pi-extensions/pull/43#pullrequestreview-5338554806
