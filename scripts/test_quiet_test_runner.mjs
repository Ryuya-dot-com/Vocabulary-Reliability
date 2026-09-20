#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  formatCommand,
  formatFailure,
  runCheck,
  runSuite
} from "./run_design_planner_checks.mjs";

const nodeCheck = (id, label, source, timeoutMs = 5_000) => ({
  id,
  label,
  command: process.execPath,
  args: ["-e", source],
  timeoutMs
});

const noisySuccess = nodeCheck(
  "noisy_success",
  "noisy success probe",
  "process.stdout.write('hidden-success-stdout\\n'); process.stderr.write('hidden-success-stderr\\n');"
);
const noisyFailure = nodeCheck(
  "noisy_failure",
  "noisy failure probe",
  "process.stdout.write('diagnostic-stdout\\n'); process.stderr.write('diagnostic-stderr\\n'); process.exit(7);"
);

const successResult = runCheck(noisySuccess);
assert.equal(successResult.passed, true);
assert.equal(successResult.exitCode, 0);
assert.match(successResult.stdout, /hidden-success-stdout/);
assert.match(successResult.stderr, /hidden-success-stderr/);
assert.match(formatCommand(noisySuccess), /hidden-success-stdout/);

const failureResult = runCheck(noisyFailure);
assert.equal(failureResult.passed, false);
assert.equal(failureResult.exitCode, 7, "numeric child exit code must be preserved");
const failureText = formatFailure(failureResult);
assert.match(failureText, /noisy failure probe/);
assert.match(failureText, /exit 7/);
assert.match(failureText, /diagnostic-stdout/);
assert.match(failureText, /diagnostic-stderr/);

const timeoutResult = runCheck(nodeCheck(
  "timeout",
  "timeout probe",
  "setTimeout(() => {}, 1000);",
  30
));
assert.equal(timeoutResult.passed, false);
assert.equal(timeoutResult.timedOut, true);
assert.equal(timeoutResult.exitCode, 124, "timeout must use the conventional exit code 124");

const memoryStream = () => ({
  value: "",
  write(chunk) { this.value += String(chunk); }
});

const quietSuccessOut = memoryStream();
const quietSuccessErr = memoryStream();
const quietSuccessSuite = runSuite([noisySuccess], {
  stdout: quietSuccessOut,
  stderr: quietSuccessErr
});
assert.equal(quietSuccessSuite.exitCode, 0);
assert.match(quietSuccessOut.value, /^PASS design-planner checks:/);
assert.doesNotMatch(quietSuccessOut.value, /hidden-success-stdout/);
assert.equal(quietSuccessErr.value, "");

const quietFailureOut = memoryStream();
const quietFailureErr = memoryStream();
const quietFailureSuite = runSuite([noisySuccess, noisyFailure], {
  stdout: quietFailureOut,
  stderr: quietFailureErr
});
assert.equal(quietFailureSuite.exitCode, 7);
assert.equal(quietFailureOut.value, "");
assert.match(quietFailureErr.value, /^FAIL design-planner checks:/);
assert.match(quietFailureErr.value, /diagnostic-stdout/);
assert.match(quietFailureErr.value, /diagnostic-stderr/);
assert.doesNotMatch(quietFailureErr.value, /hidden-success-stdout/);

console.log("Quiet test runner: success suppression, failure expansion, timeout, and exit-code preservation OK");
