# LinkClean

Removes tracking parameters from shared links and explains what each one does.

## Layout

- `packages/core` — pure TypeScript cleaning engine (no runtime dependencies)
- `rules` — rule data, bundle builder, regression tests, CLI
- `docs/superpowers` — design spec and implementation plans

## Commands

```bash
pnpm install
pnpm test               # unit tests (core + rules)
pnpm build:rules        # download ClearURLs, merge, write rules/dist/
pnpm test:regression    # offline regression against rules/dist/rules.json
pnpm test:live          # live checks for links in rules/regression.json
pnpm clean-url "<url>"  # clean one link using rules/dist/rules.json
```

## Mobile app

```bash
pnpm build:rules && pnpm mobile sync-rules   # refresh the bundled rule snapshot
pnpm mobile test                             # logic tests (Vitest, node:sqlite)
pnpm mobile typecheck
pnpm mobile ios                              # build and run on the iOS simulator
pnpm mobile android                          # build and run on the Android emulator
```

Set `SITE_BASE_URL` in `apps/mobile/src/config.ts` once the GitHub Pages site exists.
Manual checks before a release: `docs/testing/device-checklist.md`.

## Rule data

- `rules/overrides.json` — extra rules in ClearURLs provider format
- `rules/expanders.json` — which short-link domains may be expanded over the network
- `rules/knowledge.json` — explanations shown to users (zh-TW / en / ja)
- `rules/regression.json` — **public** live test links; only add links from a test account

Third-party licences: see `NOTICE.md`.
