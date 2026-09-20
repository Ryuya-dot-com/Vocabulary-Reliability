import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const read = name => readFile(new URL(`./public/${name}`, import.meta.url), "utf8");
const dom = new JSDOM(await read("index.html"), { runScripts: "outside-only" });
dom.window.eval(await read("simulation_results.js"));
const parse = dom.window.SimulationResults.parseSummary;
const base = {
  test_term: "condition_c", true_coefficient: .4, alpha: .05,
  requested_reps: 4, usable_reps: 2, failed_reps: 1, invalid_estimate_reps: 0,
  unusable_reps: 2, nonconverged_reps: 1, singular_fits: 1, usable_nonsingular_reps: 1,
  rejection_usable: .5, rejection_mcse: .353553390593274,
  rejection_wilson_low: .0945312057342307, rejection_wilson_high: .905468794265769,
  rejection_nonsingular: 0, rejection_nonsingular_mcse: 0,
  rejection_nonsingular_low: 0, rejection_nonsingular_high: .793450685622763,
  rejection_missing_lower: .25, rejection_missing_upper: .75,
  coverage_95_usable: .5, coverage_mcse: .353553390593274,
  coverage_wilson_low: .0945312057342307, coverage_wilson_high: .905468794265769
};
const csv = obj => [Object.keys(obj), Object.values(obj)].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
assert.equal(parse(csv(base)).rejection_usable, .5);
assert.equal(parse("\ufeff" + csv(base)).usable_reps, 2);
const older = { ...base }; delete older.alpha;
assert.equal(parse(csv(older)).alpha, null);
const quoted = { ...base, test_term: 'factor(a,"b")\n2' };
assert.equal(parse(csv(quoted)).term, quoted.test_term);
for (const change of [
  { requested_reps: 0 }, { usable_reps: 3 }, { failed_reps: -1 }, { usable_nonsingular_reps: 3 },
  { singular_fits: 0 }, { alpha: 0 }, { rejection_usable: .3 }, { rejection_usable: "Inf" },
  { true_coefficient: "NaN" }, { coverage_95_usable: "" }, { rejection_mcse: 0 },
  { rejection_wilson_low: .2 }, { rejection_missing_upper: .5 }, { rejection_nonsingular: 1 }
]) assert.throws(() => parse(csv({ ...base, ...change })), JSON.stringify(change));
assert.throws(() => parse(csv(base) + "extra\n"));
assert.throws(() => parse('"a","b"\n"unclosed'));
assert.throws(() => parse('"a"x,"b"\n1,2'));
assert.throws(() => parse('a,a\n1,2'));
assert.throws(() => parse('x'.repeat(65537)));
const empty = { ...base, usable_reps: 0, usable_nonsingular_reps: 0, failed_reps: 4, nonconverged_reps: 0, unusable_reps: 4, singular_fits: 0, rejection_missing_lower: 0, rejection_missing_upper: 1 };
for (const key of Object.keys(empty)) if (/^(rejection_|coverage_)/.test(key) && !key.startsWith("rejection_missing")) empty[key] = "NA";
assert.equal(parse(csv(empty)).rejection_usable, null);
assert.throws(() => parse(csv({ ...empty, rejection_mcse: 0 })));
const byId = id => dom.window.document.getElementById(id);
const input = byId("simulation-summary-file");
const choose = file => {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new dom.window.Event("change"));
};
const load = async obj => {
  choose({ name: "summary.csv", size: 2000, text: async () => csv(obj) });
  await new Promise(resolve => setTimeout(resolve, 0));
};
await load(base);
assert.equal(byId("simulation-report").hidden, false);
assert.match(byId("simulation-report-rates").textContent, /50.0% · 1 \/ 2/);
assert.match(byId("simulation-report-health").textContent, /2 \/ 4 usable/);
assert.match(byId("simulation-report-warning").textContent, /2 unusable/);
byId("simulation-exclude-singular").click();
assert.match(byId("simulation-report-rates").textContent, /0.0% · 0 \/ 1/);
assert.match(byId("simulation-report-bounds").textContent, /25.0%–75.0%/);
await load({ ...base, true_coefficient: 0 });
assert.match(byId("simulation-report-rates").textContent, /Type I error/);
assert.equal(byId("simulation-exclude-singular").checked, false);
await load(older);
assert.match(byId("simulation-report-context").textContent, /not recorded/);
await load({ ...base, test_term: '<img src=x onerror="throw 1">' });
assert.equal(byId("simulation-report-context").querySelector("img"), null);
const allSingular = { ...base, usable_nonsingular_reps: 0, singular_fits: 2 };
for (const key of Object.keys(allSingular)) if (key.startsWith("rejection_nonsingular")) allSingular[key] = "NA";
await load(allSingular);
byId("simulation-exclude-singular").click();
assert.match(byId("simulation-report-rates").textContent, /Not estimable/);
assert.match(byId("simulation-report-rates").textContent, /50.0% · 1 \/ 2/);
await load(empty);
assert.match(byId("simulation-report-rates").textContent, /Not estimable/);
assert.equal(byId("simulation-report-rates").querySelectorAll("svg").length, 0);
await load({ ...base, requested_reps: 0 });
assert.equal(byId("simulation-report").hidden, true);
assert.match(byId("simulation-import-status").textContent, /Could not read/);
let finish;
choose({ name: "slow.csv", size: 2000, text: () => new Promise(resolve => { finish = resolve; }) });
await load(empty);
finish(csv(base)); await new Promise(resolve => setTimeout(resolve, 0));
assert.match(byId("simulation-report-rates").textContent, /Not estimable/);
choose({ name: "slow.csv", size: 2000, text: () => new Promise(resolve => { finish = resolve; }) });
byId("clear-simulation-results").click();
finish(csv(base)); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(byId("simulation-report").hidden, true);
assert.equal(byId("simulation-import-status").textContent, "Imported results cleared.");
choose({ name: "huge.csv", size: 65537, text: async () => { throw Error("Should not read"); } });
assert.match(byId("simulation-import-status").textContent, /64 KB/);
byId("open-simulation-results").click();
assert.equal(byId("simulation-results").open, true);
console.log("Simulation results: CSV validation, denominators, uncertainty, failure-only runs, safe rendering and file-read races OK");
