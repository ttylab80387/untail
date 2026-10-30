# Untail

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
pnpm mobile sync-rules                       # bundle the published rules release (see below)
pnpm mobile test                             # logic tests (Vitest, node:sqlite)
pnpm mobile typecheck
pnpm mobile ios                              # build and run on the iOS simulator
pnpm mobile android                          # build and run on the Android emulator
```

Rules and the privacy policy are published to https://ttylab80387.github.io/untail/ (`SITE_BASE_URL` in `apps/mobile/src/config.ts`).
The app's built-in rules are a byte copy of a published release, so it can tell whether a downloaded copy is newer. Release order: push rule changes to main, wait for the Pages deploy, then `pnpm mobile sync-rules` (it refuses to run until 15 minutes after the deploy, while the CDN may still serve the previous release), commit `apps/mobile/assets/rules.json`, and build.
Manual checks before a release: `docs/testing/device-checklist.md`.

## Rule data

- `rules/overrides.json` — extra rules in ClearURLs provider format
- `rules/expanders.json` — which short-link domains may be expanded over the network
- `rules/knowledge.json` — explanations shown to users (zh-TW / en / ja)
- `rules/regression.json` — **public** live test links; only add links from a test account

Third-party licences: see `NOTICE.md`.
