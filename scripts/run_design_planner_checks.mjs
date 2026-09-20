#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const maxBuffer = 64 * 1024 * 1024;

export const DEFAULT_CHECKS = Object.freeze([
  {
    id: "quiet_runner_contract",
    label: "quiet-runner contract",
    command: process.execPath,
    args: ["scripts/test_quiet_test_runner.mjs"],
    timeoutMs: 10_000
  },
  {
    id: "claim_math_parity",
    label: "R/JavaScript claim-math parity",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/test_claim_math.R"],
    timeoutMs: 60_000
  },
  {
    id: "design_audit_parity",
    label: "R/JavaScript design-audit parity",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/test_design_audit.R"],
    timeoutMs: 60_000
  },
  {
    id: "bundled_data_provenance",
    label: "bundled simulation-data provenance",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/build_bundled_data.R"],
    timeoutMs: 60_000
  },
  {
    id: "static_reference_grids",
    label: "R-generated static reference grids",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/build_static_reference_grids.R"],
    timeoutMs: 60_000
  },
  {
    id: "static_decision_artifacts",
    label: "R-generated decision rules and golden fixtures",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/build_static_decision_artifacts.R"],
    timeoutMs: 60_000
  },
  {
    id: "app_inventory",
    label: "Shiny feature and dependency inventory",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/build_app_inventory.R"],
    timeoutMs: 60_000
  },
  {
    id: "static_app",
    label: "static app build and DOM contract",
    command: "npm",
    args: ["--prefix", "apps/design_planner_web", "run", "check"],
    timeoutMs: 120_000
  },
  {
    id: "planner_functions",
    label: "Shiny planner function suite",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/test_planner_functions.R"],
    timeoutMs: 240_000,
    fullOnly: true
  },
  {
    id: "shiny_runtime_probe",
    label: "Shiny source/bootstrap diagnostic",
    command: "Rscript",
    args: ["--vanilla", "apps/design_planner/probe_app_runtime.R"],
    timeoutMs: 60_000,
    fullOnly: true
  }
]);

const quoteArg = value => /^[A-Za-z0-9_./:=+-]+$/.test(value)
  ? value
  : JSON.stringify(value);

export function formatCommand(check) {
  return [check.command, ...(check.args || [])].map(quoteArg).join(" ");
}

export function runCheck(check, options = {}) {
  const started = performance.now();
  const child = spawnSync(check.command, check.args || [], {
    cwd: options.cwd || projectRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...(options.env || {})
    },
    encoding: "utf8",
    maxBuffer,
    timeout: check.timeoutMs || 120_000,
    windowsHide: true
  });
  const durationMs = performance.now() - started;
  const timedOut = child.error?.code === "ETIMEDOUT";
  const exitCode = Number.isInteger(child.status)
    ? child.status
    : timedOut
      ? 124
      : 1;
  return {
    ...check,
    commandDisplay: formatCommand(check),
    passed: !child.error && child.status === 0,
    exitCode,
    signal: child.signal || null,
    timedOut,
    error: child.error ? String(child.error.message || child.error) : "",
    stdout: child.stdout || "",
    stderr: child.stderr || "",
    durationMs
  };
}

const formatDuration = milliseconds => `${(milliseconds / 1000).toFixed(1)}s`;
const formatBytes = bytes => bytes < 1024
  ? `${bytes} B`
  : `${(bytes / 1024).toFixed(1)} KiB`;

const streamBlock = (label, value) => {
  const body = value.trimEnd();
  return `--- ${label} ---\n${body || "(empty)"}\n`;
};

export function formatFailure(result) {
  const reason = result.timedOut
    ? `timeout after ${formatDuration(result.durationMs)}`
    : result.signal
      ? `signal ${result.signal}`
      : `exit ${result.exitCode}`;
  const errorBlock = result.error ? streamBlock("runner error", result.error) : "";
  return [
    `\n[FAIL] ${result.label} (${reason})`,
    `$ ${result.commandDisplay}`,
    errorBlock + streamBlock("stdout", result.stdout) + streamBlock("stderr", result.stderr)
  ].join("\n");
}

function writeVerboseResult(stream, result) {
  const status = result.passed ? "PASS" : "FAIL";
  stream.write(`\n[${status}] ${result.label} (${formatDuration(result.durationMs)})\n`);
  stream.write(`$ ${result.commandDisplay}\n`);
  stream.write(streamBlock("stdout", result.stdout));
  stream.write(streamBlock("stderr", result.stderr));
}

export function runSuite(checks, options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const verbose = Boolean(options.verbose);
  const failFast = Boolean(options.failFast);
  const suiteLabel = options.suiteLabel || "design-planner";
  const results = [];
  const started = performance.now();

  for (const check of checks) {
    const result = runCheck(check, options);
    results.push(result);
    if (verbose) writeVerboseResult(result.passed ? stdout : stderr, result);
    if (!result.passed && failFast) break;
  }

  const failures = results.filter(result => !result.passed);
  const durationMs = performance.now() - started;
  const capturedBytes = results.reduce((total, result) =>
    total + Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 0);

  if (failures.length === 0) {
    const captureNote = verbose
      ? `${formatBytes(capturedBytes)} captured`
      : `${formatBytes(capturedBytes)} captured; use --verbose to show`;
    stdout.write(
      `PASS ${suiteLabel} checks: ${results.length}/${results.length} in ` +
      `${formatDuration(durationMs)} (${captureNote}).\n`
    );
    return { exitCode: 0, results, durationMs, capturedBytes };
  }

  stderr.write(
    `FAIL ${suiteLabel} checks: ${failures.length}/${results.length} failed in ` +
    `${formatDuration(durationMs)}.\n`
  );
  if (!verbose) {
    for (const failure of failures) stderr.write(formatFailure(failure));
  }
  return {
    exitCode: failures[0].exitCode,
    results,
    durationMs,
    capturedBytes
  };
}

function usage() {
  return [
    "Usage: node scripts/run_design_planner_checks.mjs [options]",
    "",
    "Options:",
    "  --quick      Skip the slower Shiny planner suite.",
    "  --verbose    Print stdout and stderr for every command.",
    "  --fail-fast  Stop after the first failing command.",
    "  --help       Show this help."
  ].join("\n");
}

function parseArgs(args) {
  const allowed = new Set(["--quick", "--verbose", "--fail-fast", "--help"]);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  return {
    quick: args.includes("--quick"),
    verbose: args.includes("--verbose"),
    failFast: args.includes("--fail-fast"),
    help: args.includes("--help")
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else {
      const checks = options.quick
        ? DEFAULT_CHECKS.filter(check => !check.fullOnly)
        : DEFAULT_CHECKS;
      const result = runSuite(checks, options);
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
  }
}
