#!/usr/bin/env node
/**
 * validate-registry.mjs
 *
 * Validates targets.yml against the hub-registry schema.
 * Node 22+, ESM.
 *
 * Exit codes:
 *   0  valid
 *   1  validation error
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import CronParser from 'cron-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGETS_FILE = resolve(__dirname, '..', 'targets.yml');
const AUTOMATED_REPOS = new Set(['Toni-Montez-Consulting/hub']);

// ---------------------------------------------------------------------------
// Allowed event triggers
// ---------------------------------------------------------------------------
const EVENT_TRIGGERS = new Set([
  'pr.opened',
  'pr.synchronize',
  'pr.merged',
  'push',
  'manual',
]);

/**
 * Validate a single trigger token (one side of a comma-separated list).
 * Returns an error message string, or null if valid.
 */
function validateTriggerToken(token) {
  const t = token.trim();
  if (EVENT_TRIGGERS.has(t)) return null;

  if (t.startsWith('cron:')) {
    const expr = t.slice('cron:'.length);
    try {
      CronParser.parseExpression(expr);
      return null;
    } catch {
      return `invalid cron expression: "${expr}"`;
    }
  }

  return `unknown trigger: "${t}"`;
}

/**
 * Validate a full trigger string (may be comma-separated).
 * Returns an array of error messages.
 */
function validateTrigger(trigger) {
  if (!trigger || typeof trigger !== 'string') {
    return ['trigger must be a non-empty string'];
  }
  const tokens = trigger.split(',');
  const errors = [];
  for (const token of tokens) {
    const err = validateTriggerToken(token);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * Extract all individual trigger tokens from a trigger string.
 */
function splitTrigger(trigger) {
  return trigger.split(',').map((t) => t.trim());
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const SensitivitySchema = z.enum(['low', 'medium', 'high']);

const PromptEntrySchema = z.object({
  id: z.string().min(1, 'prompt id must be a non-empty string'),
  trigger: z.string().min(1, 'trigger must be a non-empty string'),
  when: z.string().min(1, 'when must be a non-empty string when present').optional(),
  args: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const TargetEntrySchema = z.object({
  repo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, 'repo must match owner/name format'),
  branch: z.string().optional(),
  sensitivity: SensitivitySchema.optional(),
  enabled: z.boolean().optional(),
  prompts: z.array(PromptEntrySchema).min(1, 'prompts must have at least one entry'),
});

const DefaultsSchema = z.object({
  branch: z.string().optional(),
  sensitivity: SensitivitySchema.optional(),
});

const RegistrySchema = z.object({
  defaults: DefaultsSchema.optional(),
  targets: z.array(TargetEntrySchema).min(1, 'targets must have at least one entry'),
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let raw;
try {
  raw = readFileSync(TARGETS_FILE, 'utf8');
} catch (err) {
  console.error(`ERROR: could not read ${TARGETS_FILE}: ${err.message}`);
  process.exit(1);
}

let doc;
try {
  doc = parse(raw);
} catch (err) {
  console.error(`ERROR: YAML parse error in targets.yml: ${err.message}`);
  process.exit(1);
}

const parseResult = RegistrySchema.safeParse(doc);
if (!parseResult.success) {
  console.error('ERROR: targets.yml failed schema validation:');
  for (const issue of parseResult.error.issues) {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  }
  process.exit(1);
}

const registry = parseResult.data;

// ---------------------------------------------------------------------------
// Trigger validation
// ---------------------------------------------------------------------------
let triggerErrors = false;
for (const target of registry.targets) {
  for (const prompt of target.prompts) {
    const errs = validateTrigger(prompt.trigger);
    if (errs.length > 0) {
      for (const e of errs) {
        console.error(
          `ERROR: target "${target.repo}", prompt "${prompt.id}": ${e}`
        );
      }
      triggerErrors = true;
    }
  }
}
if (triggerErrors) process.exit(1);

// ---------------------------------------------------------------------------
// Duplicate (repo, prompt_id, trigger) detection
// ---------------------------------------------------------------------------
const seen = new Map(); // key -> location string
let dupErrors = false;

for (const target of registry.targets) {
  for (const prompt of target.prompts) {
    for (const token of splitTrigger(prompt.trigger)) {
      const key = `${target.repo}::${prompt.id}::${token}`;
      if (seen.has(key)) {
        console.error(
          `ERROR: duplicate (repo, prompt_id, trigger) tuple: repo="${target.repo}" id="${prompt.id}" trigger="${token}"`
        );
        dupErrors = true;
      } else {
        seen.set(key, `${target.repo} / ${prompt.id} / ${token}`);
      }
    }
  }
}
if (dupErrors) process.exit(1);

// ---------------------------------------------------------------------------
// Phase 0.1 portfolio automation boundary
// ---------------------------------------------------------------------------
let policyErrors = false;

for (const target of registry.targets) {
  if (AUTOMATED_REPOS.has(target.repo)) continue;

  if (target.enabled !== false) {
    console.error(
      `ERROR: target "${target.repo}" must stay enabled: false during Phase 0.1.`
    );
    policyErrors = true;
  }

  for (const prompt of target.prompts) {
    const tokens = splitTrigger(prompt.trigger);
    const isManualOnly = tokens.length === 1 && tokens[0] === 'manual';

    if (!isManualOnly) {
      console.error(
        `ERROR: target "${target.repo}", prompt "${prompt.id}" must use trigger: "manual" during Phase 0.1.`
      );
      policyErrors = true;
    }

    if (prompt.when) {
      console.error(
        `ERROR: target "${target.repo}", prompt "${prompt.id}" must not set "when" while disabled/manual.`
      );
      policyErrors = true;
    }
  }
}

if (policyErrors) process.exit(1);

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------
// Prompt id existence is validated by the local workspace gate.
const allPromptIds = new Set();
for (const target of registry.targets) {
  for (const prompt of target.prompts) {
    allPromptIds.add(prompt.id);
  }
}
console.log(
  `INFO: prompt ids [${[...allPromptIds].join(', ')}] are shape-valid. Run npm run validate:prompt-ids for local hub-prompts cross-validation.`
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const numTargets = registry.targets.length;
let numPairs = 0;
const cronSchedules = new Set();

for (const target of registry.targets) {
  for (const prompt of target.prompts) {
    const tokens = splitTrigger(prompt.trigger);
    numPairs += tokens.length;
    for (const token of tokens) {
      if (token.startsWith('cron:')) {
        cronSchedules.add(token.slice('cron:'.length));
      }
    }
  }
}

console.log(
  `OK: ${numTargets} target(s), ${numPairs} prompt-trigger pair(s), ${cronSchedules.size} distinct cron schedule(s).`
);
