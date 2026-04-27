# Portfolio Registry Phase 0.1

This repo is the Hub automation target registry, not the consulting knowledge registry.

Phase 0.1 uses root `.repo.yml` manifests in each sibling repo as the source of truth for portfolio inventory. `targets.yml` can still route prompt automation, but adding a repo there is a separate operational decision because it may cause prompt dispatch.

## Current Rule

- Keep `.repo.yml` manifests as the canonical inventory.
- Do not index, ingest, summarize, or mine repo contents from this file.
- Do not activate prompt targets for confidential repos unless the run is explicitly approved.
- Keep non-Hub portfolio targets disabled and manual-only until activation is approved repo by repo.
- Preserve the gate: schemas before population, population before indexing, indexing before UI.

## Sensitivity Defaults

| Repo class | Default tier | Hub routing posture |
|---|---:|---|
| Public marketing | 1 | Public-safe automation only. |
| Internal platforms and owned products | 2 | Internal routing, sanitized reuse allowed. |
| Client-style or employer-sensitive repos | 3 | No cross-engagement reuse without sanitization. |

## Portfolio Repos

The known Phase 0.1 portfolio repos are:

- `consulting`
- `engineering-playbook`
- `hub`
- `hub-prompts`
- `hub-registry`
- `fitness-app`
- `FamilyTrips`
- `demario-pickleball-1`
- `dse-content`

`fitness-app` / Omnexus is intentionally deferred from local manifest validation in this pass because another local session owns that checkout. Registry references to Omnexus must stay disabled and manual-only until that session is clear.

## Validation

Run both checks before pushing registry changes:

```bash
npm run validate
npm run validate:manifests
```

`validate:manifests` checks the sibling repo manifests that are in scope for this pass and deliberately skips `fitness-app`.
