@AGENTS.md

# Insta Quote take-home

Take-home for Insta Quote AI (Full Stack Engineer). Part A: `POST /api/extract` turns a PDF into
line items with evidence plus a list of refusals. Part B: an upload page that shows both, in plain
language. Next.js 16 on Vercel, one app. The plan lives in `docs/plans/`.

## Commands

```bash
pnpm dev          # http://localhost:3000
pnpm test         # vitest run
pnpm typecheck    # next typegen && tsc --noEmit
pnpm lint
pnpm build
```

Sample PDFs are in `public/samples/` (tests read them from there too).

## Extraction rules (non-negotiable)

- Never output a number that can't be pointed at: every extracted value carries its page and the
  exact source text, and its `raw` string must appear verbatim in that source text.
- Never fill a gap. A missing, unreadable, ambiguous or contradictory value becomes a refusal with a
  plain-language reason, not a guess and not a "corrected" value.
- A refusal is a successful result (HTTP 200). HTTP errors are only for requests we can't process at
  all (not a PDF, too large, corrupt). Neither may reach the UI as a generic "something went wrong".
- Contain failures: a bad page or row produces a refusal for that page or row; the rest still extracts.

## Code style

- Comments only where the code can't speak for itself: a non-obvious why, a document quirk, a
  workaround. One short line, written like a colleague would say it. No docstring essays, no
  restating what the code does, no section banners.
- Prefer small focused modules under `src/lib/extraction/`; keep that folder free of Next.js imports
  so it stays testable in plain Node.

## Git

- Branch per phase: `feat/phase-N-<slug>` (or `chore/`, `fix/`), merged into `main` through a PR.
- Conventional commits with a scope, one logical change each: `feat(extraction): ...`,
  `test(rules): ...`, `fix(ui): ...`, `docs: ...`.
- Never add `Co-Authored-By: Claude` or `Generated with Claude Code` to commits or PR bodies.
  The user is the only author.
