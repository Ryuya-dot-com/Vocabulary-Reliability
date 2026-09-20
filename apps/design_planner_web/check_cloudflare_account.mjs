#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const wrangler = path.join(appRoot, "node_modules", ".bin", "wrangler");
const identityPattern = /komuro|ryuya|tohoku|tohokusla/i;
const dnsLabelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function parseVerifiedSubdomain(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--verified-subdomain") {
    return args[1].toLowerCase();
  }
  process.stderr.write(
    "Usage: node check_cloudflare_account.mjs [--verified-subdomain <dashboard-subdomain>]\n"
  );
  process.exit(2);
}

function valuesAtMatchingKeys(value, keyPattern, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) valuesAtMatchingKeys(entry, keyPattern, output);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (keyPattern.test(key) && typeof entry === "string") output.push(entry);
      valuesAtMatchingKeys(entry, keyPattern, output);
    }
  }
  return output;
}

const verifiedSubdomain = parseVerifiedSubdomain(process.argv.slice(2));

const result = spawnSync(wrangler, ["whoami", "--json"], {
  cwd: appRoot,
  env: {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    WRANGLER_LOG_PATH: "/tmp/reliability-design-wrangler-account.log"
  },
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
  timeout: 30_000,
  windowsHide: true
});

if (result.error || result.status !== 0) {
  const reason = result.error?.code === "ETIMEDOUT"
    ? "timeout"
    : "not authenticated or Cloudflare was unreachable";
  process.stderr.write(`CLOUDFLARE_ACCOUNT_PREFLIGHT=BLOCKED (${reason})\n`);
  process.exitCode = 1;
} else {
  try {
    const data = JSON.parse(result.stdout);
    const accounts = Array.isArray(data.accounts)
      ? data.accounts
      : Array.isArray(data.memberships)
        ? data.memberships
        : [];
    const accountNames = valuesAtMatchingKeys(accounts, /^(?:name|account_name)$/i);
    const subdomains = valuesAtMatchingKeys(data, /subdomain/i);
    const identifyingAccountMetadata = accountNames.some(value => identityPattern.test(value));
    const publicSubdomains = subdomains.length
      ? subdomains.map(value => value.toLowerCase())
      : verifiedSubdomain
        ? [verifiedSubdomain]
        : [];
    const publicSubdomainSource = subdomains.length
      ? "wrangler"
      : verifiedSubdomain
        ? "manual_dashboard_assertion"
        : "dashboard_required";
    const validPublicSubdomain = publicSubdomains.length > 0
      && publicSubdomains.every(value => dnsLabelPattern.test(value));
    const identifyingSubdomain = publicSubdomains.some(value => identityPattern.test(value));

    process.stdout.write("CLOUDFLARE_AUTHENTICATED=yes\n");
    process.stdout.write(`CLOUDFLARE_ACCOUNT_COUNT=${accounts.length || "unknown"}\n`);
    process.stdout.write(
      `CLOUDFLARE_PRIVATE_ACCOUNT_METADATA_IDENTIFYING=${identifyingAccountMetadata ? "yes" : "no_or_unknown"}\n`
    );
    process.stdout.write("CLOUDFLARE_PRIVATE_ACCOUNT_METADATA_RELEASE_CRITERION=no\n");
    process.stdout.write(`CLOUDFLARE_PUBLIC_SUBDOMAIN_SOURCE=${publicSubdomainSource}\n`);
    if (publicSubdomains.length) {
      process.stdout.write(`CLOUDFLARE_PUBLIC_SUBDOMAIN_VALID=${validPublicSubdomain ? "yes" : "no"}\n`);
      process.stdout.write(`CLOUDFLARE_PUBLIC_SUBDOMAIN_ANONYMOUS=${identifyingSubdomain ? "no" : "yes"}\n`);
    } else {
      process.stdout.write("CLOUDFLARE_PUBLIC_SUBDOMAIN_VALID=manual_dashboard_check_required\n");
      process.stdout.write("CLOUDFLARE_PUBLIC_SUBDOMAIN_ANONYMOUS=manual_dashboard_check_required\n");
    }
    const releaseReady = validPublicSubdomain && !identifyingSubdomain;
    process.stdout.write(`CLOUDFLARE_RELEASE_ACCOUNT_READY=${releaseReady ? "yes" : "no"}\n`);
    if (!releaseReady) process.exitCode = 1;
  } catch {
    process.stderr.write("CLOUDFLARE_ACCOUNT_PREFLIGHT=BLOCKED (unexpected Wrangler JSON)\n");
    process.exitCode = 2;
  }
}
