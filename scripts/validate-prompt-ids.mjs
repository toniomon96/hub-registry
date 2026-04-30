#!/usr/bin/env node
/**
 * validate-prompt-ids.mjs
 *
 * Cross-validates every prompt id referenced in targets.yml against the
 * sibling hub-prompts prompt catalogue. This is a local workspace gate by
 * design; repo-scoped CI should not need private sibling checkout access yet.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const targetsFile = resolve(repoRoot, 'targets.yml');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readYamlFile(filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`could not read ${label} at ${filePath}: ${err.message}`);
  }

  try {
    return parse(raw);
  } catch (err) {
    fail(`YAML parse error in ${label}: ${err.message}`);
  }
}

function resolvePromptsDir() {
  const configuredPath = process.env.HUB_PROMPTS_PATH?.trim();
  const promptsRoot = configuredPath ? resolve(configuredPath) : resolve(repoRoot, '..', 'hub-prompts');
  return basename(promptsRoot) === 'prompts' ? promptsRoot : join(promptsRoot, 'prompts');
}

function collectPromptReferences(registry) {
  const references = new Map();
  const targets = Array.isArray(registry?.targets) ? registry.targets : null;
  if (!targets) fail('targets.yml must contain a top-level targets array');

  for (const target of targets) {
    const repo = typeof target?.repo === 'string' ? target.repo : '<unknown repo>';
    const entries = Array.isArray(target?.prompts)
      ? target.prompts.map((entry) => ({ id: entry?.id, repo }))
      : Array.isArray(target?.targets)
        ? target.targets.map((entry) => ({ id: entry?.prompt_id, repo }))
        : [];

    for (const entry of entries) {
      if (typeof entry.id !== 'string' || entry.id.trim() === '') {
        fail(`target "${repo}" has a prompt entry without a non-empty id`);
      }
      const id = entry.id.trim();
      const repos = references.get(id) ?? new Set();
      repos.add(repo);
      references.set(id, repos);
    }
  }

  if (references.size === 0) fail('targets.yml does not reference any prompt ids');
  return references;
}

function extractFrontmatter(raw, file) {
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail(`${file} is missing YAML frontmatter`);
  return match[1];
}

function collectPromptCatalogIds(promptsDir) {
  if (!existsSync(promptsDir)) fail(`hub-prompts prompts directory not found: ${promptsDir}`);

  const files = readdirSync(promptsDir)
    .filter((file) => file.endsWith('.md'))
    .sort();

  if (files.length === 0) fail(`no prompt markdown files found in ${promptsDir}`);

  const ids = new Set();
  for (const file of files) {
    const filePath = join(promptsDir, file);
    const raw = readFileSync(filePath, 'utf8');
    const frontmatter = readYamlFrontmatter(raw, file);
    const id = frontmatter?.id;
    if (typeof id !== 'string' || id.trim() === '') {
      fail(`${file} has no non-empty frontmatter id`);
    }
    const expectedId = file.slice(0, -'.md'.length);
    if (id !== expectedId) {
      fail(`${file} frontmatter id "${id}" does not match filename "${expectedId}"`);
    }
    ids.add(id);
  }

  return ids;
}

function readYamlFrontmatter(raw, file) {
  const yamlText = extractFrontmatter(raw, file);
  try {
    return parse(yamlText);
  } catch (err) {
    fail(`YAML parse error in ${file} frontmatter: ${err.message}`);
  }
}

const registry = readYamlFile(targetsFile, 'targets.yml');
const references = collectPromptReferences(registry);
const promptsDir = resolvePromptsDir();
const promptIds = collectPromptCatalogIds(promptsDir);

const missing = [...references.keys()].filter((id) => !promptIds.has(id)).sort();
if (missing.length > 0) {
  console.error('ERROR: targets.yml references prompt ids that do not exist in hub-prompts:');
  for (const id of missing) {
    const repos = [...references.get(id)].sort().join(', ');
    console.error(`  - ${id} (referenced by ${repos})`);
  }
  console.error(`Checked prompt catalog: ${promptsDir}`);
  process.exit(1);
}

console.log(
  `OK: ${references.size} referenced prompt id(s) exist in hub-prompts (${promptsDir}).`,
);
