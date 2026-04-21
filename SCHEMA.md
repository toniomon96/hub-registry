# SCHEMA.md — targets.yml schema reference

This document describes every field in `targets.yml` and the supported trigger grammar.

---

## Top-level structure

```yaml
defaults:
  branch: main        # default branch when cloning target repos
  sensitivity: medium # default sensitivity; overrides a prompt's own default

targets:
  - ...               # list of target entries (see below)
```

### `defaults`

| Field | Type | Required | Description |
|---|---|---|---|
| `branch` | string | no | Branch to clone when the target entry omits `branch`. Defaults to `main`. |
| `sensitivity` | `low` \| `medium` \| `high` | no | Fallback sensitivity. Defaults to `medium`. |

---

## Target entry

```yaml
- repo: owner/name          # required
  branch: main              # optional
  sensitivity: high         # optional
  enabled: true             # optional, default true
  prompts:
    - id: some-prompt-id    # required
      trigger: "pr.opened"  # required
      when: "base_ref == 'main'"  # optional
      args:                 # optional
        key: value
      enabled: true         # optional, default true
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo` | string | **yes** | — | GitHub slug in `owner/name` format. Must match `^[^/]+/[^/]+$`. |
| `branch` | string | no | `defaults.branch` | Branch to use when cloning this repo. |
| `sensitivity` | `low` \| `medium` \| `high` | no | `defaults.sensitivity` | Overrides the file default and the prompt's own default. |
| `enabled` | boolean | no | `true` | Set to `false` to pause all prompts for this target without deleting the entry. |
| `prompts` | array | **yes** | — | One or more prompt-trigger pairs. |

---

## Prompt entry (inside `prompts`)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | **yes** | — | Prompt identifier. Must exist in `hub-prompts`. Not validated cross-repo. |
| `trigger` | string | **yes** | — | One or more triggers, comma-separated. See [Trigger grammar](#trigger-grammar). |
| `when` | string | no | — | Expression evaluated against the event payload. Must be a non-empty string when present. See [When expressions](#when-expressions). |
| `args` | map | no | `{}` | Arbitrary key-value pairs passed as prompt inputs at render time. |
| `enabled` | boolean | no | `true` | Set to `false` to disable this specific prompt-trigger pair. |

---

## Trigger grammar

### Event triggers

| Value | Fires when… |
|---|---|
| `pr.opened` | A pull request is opened. |
| `pr.synchronize` | New commits are pushed to an open pull request. |
| `pr.merged` | A pull request is merged. Gate the target branch with `when`. |
| `push` | A push to any branch. Gate with `when` to restrict to a specific ref. |
| `manual` | Only fires via explicit CLI / MCP / HTTP invocation. |

### Cron trigger

```
cron:<5-field-cron-expression>
```

Standard 5-field cron syntax interpreted in the Hub's configured timezone.

| Field | Allowed values |
|---|---|
| Minute | `0–59` |
| Hour | `0–23` |
| Day of month | `1–31` |
| Month | `1–12` or `JAN–DEC` |
| Day of week | `0–7` (0 and 7 = Sunday) or `SUN–SAT` |

Examples:

| Expression | Meaning |
|---|---|
| `cron:0 9 * * 1` | Every Monday at 09:00 |
| `cron:30 6 * * 1-5` | Weekdays at 06:30 |
| `cron:0 0 1 * *` | First day of every month at midnight |
| `cron:*/15 * * * *` | Every 15 minutes |

### Multiple triggers

Comma-separate multiple triggers on a single entry:

```yaml
trigger: "pr.opened,pr.synchronize"
trigger: "push,manual"
```

---

## When expressions

The `when` field is a JavaScript-expression fragment evaluated against the event payload by the Hub. This repo only validates that the value is a non-empty string — it does not run the evaluator.

### Supported payload fields (examples)

| Field | Type | Available on |
|---|---|---|
| `additions` | number | `pr.*` events |
| `deletions` | number | `pr.*` events |
| `base_ref` | string | `pr.*`, `push` |
| `labels` | string[] | `pr.*` events |
| `head_ref` | string | `pr.*` events |

### Example expressions

```yaml
# Run only on large diffs
when: "additions + deletions >= 300"

# Run only on small diffs
when: "additions + deletions < 300"

# Run only when merging into main
when: "base_ref == 'main'"

# Run only when the PR has a specific label
when: "labels.includes('needs-review')"
```

---

## Worked example

```yaml
defaults:
  branch: main
  sensitivity: medium

targets:
  - repo: acme-org/api-service
    sensitivity: high
    prompts:

      # Weekly codebase audit every Monday at 09:00
      - id: codebase-audit
        trigger: "cron:0 9 * * 1"

      # Detailed PR review for large diffs
      - id: pr-review-detailed
        trigger: "pr.opened,pr.synchronize"
        when: "additions + deletions >= 300"

      # Lightweight PR review for small diffs
      - id: pr-review-tight
        trigger: "pr.opened,pr.synchronize"
        when: "additions + deletions < 300"

  - repo: acme-org/frontend
    # inherits defaults.sensitivity = medium
    prompts:
      - id: pr-review-tight
        trigger: "pr.opened"
        args:
          focus_area: accessibility
        enabled: true
```

---

## Sensitivity inheritance

Effective sensitivity is resolved in this order (first match wins):

1. `targets[].sensitivity` (target-level override)
2. `defaults.sensitivity` (file-wide default)
3. Prompt's own default defined in `hub-prompts`

| Level | Example value | Typical effect |
|---|---|---|
| `low` | public OSS projects | May use cloud LLM |
| `medium` | internal tools | Hub decides routing |
| `high` | sensitive / proprietary | Forces local LLM routing |
