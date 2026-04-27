#!/usr/bin/env node
/**
 * validate-manifests.mjs
 *
 * Phase 0.1 portfolio manifest validation. This checks the root `.repo.yml`
 * files that are in scope for this pass without reading or touching
 * `fitness-app`, which is owned by another local session right now.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portfolioRoot = resolve(__dirname, "../..");

const expectedRepos = [
  "consulting",
  "engineering-playbook",
  "hub",
  "hub-prompts",
  "hub-registry",
  "FamilyTrips",
  "demario-pickleball-1",
  "dse-content",
];

const deferredRepos = ["fitness-app"];

const nullableString = z.union([z.string(), z.null()]);

const ManifestSchema = z.object({
  repo_id: z.string().min(1),
  display_name: z.string().min(1),
  repo_type: z.enum([
    "internal-platform",
    "internal-product",
    "personal-marketing",
    "client-engagement",
    "client-handoff-archive",
    "experimental",
  ]),
  owner: z.string().min(1),
  client_id: nullableString,
  engagement_id: nullableString,
  sensitivity_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  domains: z.array(z.string().min(1)).min(1),
  allowed_context_consumers: z.array(z.string().min(1)).min(1),
  artifact_roots: z.array(z.string().min(1)).min(1),
  source_of_truth_files: z.array(z.string().min(1)).min(1),
  status: z.enum(["active", "archived", "sunset"]),
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last_verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

let hasError = false;

function fail(repo, message) {
  hasError = true;
  console.error(`${repo}: ${message}`);
}

for (const repo of expectedRepos) {
  const manifestPath = resolve(portfolioRoot, repo, ".repo.yml");
  if (!existsSync(manifestPath)) {
    fail(repo, "missing .repo.yml");
    continue;
  }

  let manifest;
  try {
    manifest = parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(repo, `could not parse .repo.yml: ${err.message}`);
    continue;
  }

  const result = ManifestSchema.safeParse(manifest);
  if (!result.success) {
    for (const issue of result.error.issues) {
      fail(repo, `[${issue.path.join(".")}] ${issue.message}`);
    }
    continue;
  }

  const data = result.data;
  if (data.sensitivity_tier === 3 && data.allowed_context_consumers.includes("cross-engagement-agents")) {
    fail(repo, "tier 3 manifests must not allow cross-engagement-agents");
  }

  if (data.repo_type === "client-engagement" && (!data.client_id || !data.engagement_id)) {
    fail(repo, "client-engagement manifests must set client_id and engagement_id");
  }
}

if (hasError) {
  console.error("\nPortfolio manifest validation failed.\n");
  process.exit(1);
}

console.log(`OK: ${expectedRepos.length} manifest(s) valid.`);
console.log(`Deferred by design: ${deferredRepos.join(", ")}.`);
