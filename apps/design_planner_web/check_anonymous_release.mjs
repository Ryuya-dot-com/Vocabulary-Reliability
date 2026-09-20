#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(appRoot, "public");
const controlFiles = new Set([".assetsignore", "_headers"]);

const expectedAssets = new Set([
  "app.js",
  "study_plan.js",
  "simulation_data.js", "simulation_results.js",
  "audit_data.js",
  "build-meta.json",
  "claim_data.js",
  "claim_math.js",
  "claim_math_fixtures.json",
  "decision_rules.json",
  "design_audit.js",
  "design_audit.schema.json",
  "design_audit_fixtures.json",
  "golden_test_fixtures.json",
  "index.html",
  "inferential_target_registry.json",
  "reference_grids.json",
  "styles.css",
  "validation_registry.json"
]);

const forbidden = [
  ["author surname", /komuro/i],
  ["author given name", /ryuya/i],
  ["institution", /tohoku/i],
  ["local account name", /tohokusla/i],
  ["author ORCID", /0000-0001-9205-0926/i],
  ["grant identifier", /25K16344/i],
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["ORCID-like identifier", /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i],
  ["macOS/Linux home path", /(?:\/Users\/|\/home\/)[^/\s"']+/i],
  ["Windows home path", /[A-Z]:\\Users\\[^\\\s"']+/i],
  ["Dropbox path", /dropbox/i],
  ["local file URL", /file:\/\//i],
  ["HTML author metadata", /<meta\s+[^>]*name=["']author["']/i]
];

function fail(messages) {
  for (const message of messages) process.stderr.write(`- ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  if (args.length === 0) return { accountSubdomain: null };
  if (args.length === 2 && args[0] === "--account-subdomain") {
    return { accountSubdomain: args[1].toLowerCase() };
  }
  throw new Error(
    "Usage: node check_anonymous_release.mjs " +
    "[--account-subdomain <generic-workers-dev-subdomain>]"
  );
}

function scanText(label, text) {
  return forbidden
    .filter(([, pattern]) => pattern.test(text))
    .map(([description]) => `${label}: contains ${description}`);
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...await listFiles(absolute, base));
    } else {
      output.push(path.relative(base, absolute).split(path.sep).join("/"));
    }
  }
  return output.sort();
}

try {
  const { accountSubdomain } = parseArgs(process.argv.slice(2));
  const errors = [];
  const entries = await listFiles(publicRoot);
  const files = entries.filter(file => !controlFiles.has(file));

  for (const file of entries) {
    if (!expectedAssets.has(file) && !controlFiles.has(file)) {
      errors.push(`${file}: unexpected deployable asset`);
    }
  }
  for (const file of expectedAssets) {
    if (!files.includes(file)) errors.push(`${file}: expected deployable asset is missing`);
  }

  for (const file of files) {
    const absolute = path.join(publicRoot, file);
    const info = await stat(absolute);
    if (!info.isFile()) {
      errors.push(`${file}: deployable entry is not a regular file`);
      continue;
    }
    errors.push(...scanText(`public/${file}`, await readFile(absolute, "utf8")));
  }
  for (const file of controlFiles) {
    if (!entries.includes(file)) {
      errors.push(`public/${file}: release control is missing`);
    } else {
      errors.push(...scanText(`public/${file}`, await readFile(path.join(publicRoot, file), "utf8")));
    }
  }

  const wranglerPath = path.join(appRoot, "wrangler.jsonc");
  const wranglerText = await readFile(wranglerPath, "utf8");
  const wrangler = JSON.parse(wranglerText);
  const packageMetadata = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
  errors.push(...scanText("wrangler.jsonc", wrangler.name || ""));
  if (packageMetadata.name !== wrangler.name) {
    errors.push("package.json: package name must match the Cloudflare Worker name");
  }
  if (wrangler.workers_dev !== true) {
    errors.push("wrangler.jsonc: workers_dev must be explicitly true for the reviewed workers.dev release");
  }
  if (wrangler.preview_urls !== false) {
    errors.push("wrangler.jsonc: preview_urls must be explicitly false");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(wrangler.name || "")) {
    errors.push("wrangler.jsonc: Worker name is not a valid anonymous DNS label");
  }

  let plannedUrl = "";
  if (accountSubdomain) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(accountSubdomain)) {
      errors.push("account subdomain: must be a 1-63 character lowercase DNS label");
    }
    errors.push(...scanText("account subdomain", accountSubdomain));
    plannedUrl = `; planned URL https://${wrangler.name}.${accountSubdomain}.workers.dev`;
  }

  if (errors.length) {
    process.stderr.write(`FAIL anonymous release gate: ${errors.length} issue(s)\n`);
    fail(errors);
  } else {
    const accountNote = accountSubdomain
      ? plannedUrl
      : "; account subdomain still requires deployment-time verification";
    process.stdout.write(
      `PASS anonymous release gate: ${files.length} allowlisted assets, ` +
      `identity scan clean, preview URLs disabled${accountNote}.\n`
    );
  }
} catch (error) {
  process.stderr.write(`FAIL anonymous release gate: ${error.message}\n`);
  process.exitCode = 2;
}
