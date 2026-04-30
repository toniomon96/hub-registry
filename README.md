# hub-registry

**hub-registry** is the _target registry_ for the Hub automation platform. It declares which AI prompts run against which GitHub repositories, on which triggers, and with which settings.

The Hub clones this repository on each sync cycle and loads `targets.yml` into its SQLite `prompt_targets` table. You do not need to deploy anything — a `git push` is enough to change behaviour.

---

## Table of contents

- [How the Hub consumes this repo](#how-the-hub-consumes-this-repo)
- [How to add a new target](#how-to-add-a-new-target)
- [How to wire a new prompt](#how-to-wire-a-new-prompt)
- [Sensitivity inheritance](#sensitivity-inheritance)
- [Trigger grammar](#trigger-grammar)
- [Local cross-validation](#local-cross-validation)
- [Replacing TONI-PLACEHOLDER](#replacing-toni-placeholder)
- [Validation](#validation)

---

## How the Hub consumes this repo

1. The Hub clones `hub-registry` (this repo).
2. It parses `targets.yml` and upserts every `(repo, prompt_id, trigger)` triple into the `prompt_targets` SQLite table.
3. When an event fires (webhook, cron tick, or manual invocation), the Hub queries the table, fetches the matching prompt body from `hub-prompts`, renders it with the supplied `args`, and dispatches it to the configured LLM.

Prompt bodies live in the companion repo [`hub-prompts`](https://github.com/toniomon96/hub-prompts). This repo references prompts only by `id`; it does not contain prompt text.

---

## How to add a new target

1. Open `targets.yml`.
2. Add a new entry under `targets:`:

```yaml
targets:
  - repo: owner/my-new-repo        # GitHub slug
    sensitivity: medium            # optional, overrides defaults
    prompts:
      - id: pr-review-detailed
        trigger: "pr.opened,pr.synchronize"
        when: "additions + deletions >= 300"
```

3. Run `npm test` locally to confirm the registry shape, sibling manifests, and prompt ids are valid.
4. Open a pull request. The CI workflow re-runs the repo-scoped registry validation.

---

## How to wire a new prompt

A _prompt_ must already exist in `hub-prompts` with the given `id`. Then:

1. Find (or create) the target entry for the repo you want to run the prompt against.
2. Add a new item inside `prompts:`:

```yaml
- id: my-new-prompt-id
  trigger: "cron:0 8 * * *"      # daily at 08:00
  args:
    focus_area: security
```

3. Run `npm test` locally so the new id is checked against the sibling `hub-prompts` catalogue.
4. Open a PR as above.

---

## Sensitivity inheritance

Sensitivity controls which LLM backend the Hub uses (e.g. cloud vs. local).

The effective sensitivity for a prompt run is determined in this order (first match wins):

1. **Target-level `sensitivity`** — set on the `targets` entry.
2. **`defaults.sensitivity`** — the file-wide default.
3. **Prompt default** — defined in `hub-prompts` for that prompt id.

Example: if `defaults.sensitivity` is `medium` but a target sets `sensitivity: high`, all prompts under that target use `high`.

Allowed values: `low`, `medium`, `high`.

---

## Trigger grammar

| Trigger | Description |
|---|---|
| `cron:<expr>` | Standard 5-field cron expression, interpreted in the Hub's configured timezone. Example: `cron:0 9 * * 1` = Mondays at 09:00. |
| `pr.opened` | A pull request was opened. |
| `pr.synchronize` | New commits were pushed to an open pull request. |
| `pr.merged` | A pull request was merged (gate the target branch with `when`). |
| `push` | A push to any branch (gate with `when: "base_ref == 'main'"` to restrict). |
| `manual` | Only runs via explicit CLI / MCP / HTTP invocation. |

Multiple triggers on one entry are comma-separated:

```yaml
trigger: "pr.opened,pr.synchronize"
```

### `when` expressions

The optional `when` field is a JavaScript-expression fragment evaluated against the event payload. Examples:

```yaml
when: "additions + deletions >= 300"
when: "additions + deletions < 300"
when: "base_ref == 'main'"
when: "labels.includes('needs-review')"
```

The Hub implements the evaluator. This repo only validates that `when` is a non-empty string when present.

---

## Local cross-validation

`npm run validate:prompt-ids` checks every prompt id in `targets.yml` against the sibling `hub-prompts/prompts/` catalogue. It uses `HUB_PROMPTS_PATH` when set, otherwise it expects `../hub-prompts`.

GitHub Actions intentionally keeps the repo-scoped CI gate thin for now. Run the full local `npm test` gate before merging registry edits that add or change prompt ids.

---

## Replacing TONI-PLACEHOLDER

The seed entry in `targets.yml` uses the placeholder owner `TONI-PLACEHOLDER`. To replace it:

1. Find the real GitHub organisation or user slug at `https://github.com/<owner>`.
2. Do a global find-and-replace of `TONI-PLACEHOLDER` with the real slug in `targets.yml`.
3. Run `npm run validate`, commit, and open a PR.

---

## Validation

```bash
npm install
npm run validate
npm run validate:prompt-ids
npm test
```

The registry validator:
- Parses `targets.yml`
- Validates the structure with a Zod schema
- Checks every `repo` slug matches `^[^/]+/[^/]+$`
- Validates every `trigger` against the allowed grammar (cron expressions are parsed with `cron-parser`)
- Fails on duplicate `(repo, prompt_id, trigger)` tuples
- Prints a summary: N targets, M prompt-trigger pairs, K distinct cron schedules

The prompt-id validator:
- Reads every referenced prompt id in `targets.yml`.
- Reads only YAML frontmatter from `hub-prompts/prompts/*.md`.
- Fails if any referenced id is missing from the prompt catalogue.

The repo-scoped registry check runs automatically on every push and pull request via `.github/workflows/validate.yml`. The full local gate remains `npm test`.
