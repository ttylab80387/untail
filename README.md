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

## Rule data

- `rules/overrides.json` — extra rules in ClearURLs provider format
- `rules/expanders.json` — which short-link domains may be expanded over the network
- `rules/knowledge.json` — explanations shown to users (zh-TW / en / ja)
- `rules/regression.json` — **public** live test links; only add links from a test account

Third-party licences: see `NOTICE.md`.
