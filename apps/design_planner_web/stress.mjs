#!/usr/bin/env node
// Deterministic engineering stress checks, not Monte Carlo validation of a study.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const root = path.dirname(fileURLToPath(import.meta.url));
const math = createRequire(import.meta.url)("../design_planner/claim_math.js");
const started = performance.now();
const seed = 20260919;
let randomState = seed;
const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const integer = max => Math.floor(random() * max);
const close = (actual, expected, message) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-12, Number.MIN_VALUE),
  `${message}: ${actual} versus ${expected}`
);
const oracle = input => Math.hypot(input.person_slope_sd / Math.sqrt(input.n_person),
  input.memory_adjusted ? 0 : input.memory_moderation / Math.sqrt(input.n_person),
  input.item_slope_sd / Math.sqrt(2 * input.k_per_condition));
const numericSamples = [];
for (let index = 0; index < 12000; index++) {
  const sd = () => random() < .1 ? 0 : 10 ** (-140 + 280 * random());
  const input = { n_person: 1 + integer(1e9), k_per_condition: 1 + integer(1e9),
    person_slope_sd: sd(), item_slope_sd: sd(), memory_moderation: sd(), memory_adjusted: random() < .5 };
  const baseline = math.effectProjection(input);
  close(baseline.sampling_sd, oracle(input), `hypot oracle at seed ${seed}, sample ${index}`);
  for (const counts of [{ n_person: input.n_person * 3 }, { k_per_condition: input.k_per_condition * 3 }]) {
    const expanded = math.effectProjection({ ...input, ...counts });
    assert.ok(expanded.sampling_sd <= baseline.sampling_sd * (1 + 1e-14), `monotonicity at sample ${index}`);
  }
  const adjusted = math.effectProjection({ ...input, memory_adjusted: true });
  assert.ok(adjusted.sampling_sd <= baseline.sampling_sd * (1 + 1e-14));
  const scaled = math.effectProjection({ ...input, person_slope_sd: input.person_slope_sd * 3,
    item_slope_sd: input.item_slope_sd * 3, memory_moderation: input.memory_moderation * 3 });
  close(scaled.sampling_sd, 3 * baseline.sampling_sd, `scale invariance at sample ${index}`);
  if (index < 100) numericSamples.push(input);
}
for (let index = 0; index < 3000; index++) {
  const k = 1 + integer(1e7), r = random();
  const alpha = math.expectedAlpha(k, r);
  assert.ok(alpha >= r - 1e-15 && alpha <= 1);
  assert.ok(math.expectedAlpha(k * 2, r) >= alpha - 1e-15);
  close(math.expectedAlpha(1, r), r, "one-item identity");
}
console.log("Stress: 12,000 projection cases and 3,000 alpha cases passed.");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", error => errors.push(error.message));
const dom = new JSDOM(await readFile(path.join(root, "public/index.html"), "utf8"), {
  url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole
});
for (const file of ["design_audit.js", "claim_math.js", "audit_data.js", "claim_data.js", "simulation_data.js", "study_plan.js", "simulation_results.js", "app.js"]) {
  dom.window.eval(await readFile(path.join(root, "public", file), "utf8"));
}
const doc = dom.window.document;
const byId = id => doc.getElementById(id);
let events = 0;
const set = (id, value) => {
  byId(id).value = String(value);
  byId(id).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  events++;
};
const calculation = () => JSON.parse(byId("payload-output").textContent).inferential_route.calculation;
const start = () => { byId("start-effect-planning").click(); events++; };
const template = id => {
  byId("template-select").value = id;
  byId("template-select").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  events++;
};
const fields = ["person_slope_sd", "item_slope_sd", "memory_moderation", "memory_adjusted"];
let retained = [];
const stats = { valid: 0, invalid: 0, blocked: 0, keeps: 0, removes: 0, reuses: 0, downloads: 0 };
const baselineElements = doc.querySelectorAll("*").length;
let maxElements = baselineElements;
let blob, objectUrls = 0;
dom.window.Blob = Blob;
dom.window.URL.createObjectURL = value => { blob = value; objectUrls++; return "blob:stress"; };
dom.window.URL.revokeObjectURL = () => { objectUrls--; };
doc.addEventListener("click", event => {
  if (event.target.tagName === "A" && event.target.download) {
    event.preventDefault();
    assert.equal(event.target.download, "vocabulary-design-sensitivity.R");
  }
});
const checkUI = () => {
  assert.deepEqual(errors, []);
  const state = calculation();
  if (state.status !== "computed_sensitivity") {
    stats[state.status === "invalid_input" ? "invalid" : "blocked"]++;
    assert.equal(byId("effect-comparison").hidden, true);
    assert.equal(byId("effect-comparison-rows").children.length, 0);
    assert.equal(byId("assumption-set-cards").children.length, 0);
    for (const id of ["effect-takeaway", "effect-interpretation", "effect-r-code", "assumption-comparison-summary"]) {
      assert.equal(byId(id).textContent, "", `stale ${id} after failed projection`);
    }
    assert.equal(byId("download-effect-r").disabled, true);
    assert.equal(byId("keep-effect-assumptions").disabled, true);
    assert.equal(byId("plan-setup").hidden, false);
    return;
  }
  stats.valid++;
  close(state.result.sampling_sd, oracle(state.inputs), "DOM projection");
  if (state.result.sampling_sd > 0) assert.ok(Number(byId("effect-value").textContent) > 0, "positive SD must not display as zero");
  assert.doesNotMatch(byId("learner-curve").getAttribute("d"), /NaN|Infinity/);
  assert.doesNotMatch(byId("word-curve").getAttribute("d"), /NaN|Infinity/);
  assert.equal(byId("effect-comparison-rows").children.length, 3);
  const sets = state.assumption_comparison.sets;
  assert.equal(sets.length, retained.length);
  assert.ok(sets.length <= 3);
  for (const [index, saved] of retained.entries()) {
    assert.equal(sets[index].id, saved.id);
    for (const field of fields) assert.equal(sets[index][field], saved[field]);
    for (const plan of sets[index].comparison) {
      assert.ok(Number.isSafeInteger(plan.n) && Number.isSafeInteger(2 * plan.k));
      close(plan.sampling_sd, oracle({ ...saved, n_person: plan.n, k_per_condition: plan.k }), "held-set projection");
      assert.ok(plan.sd_reduction === null || (plan.sd_reduction >= -1e-14 && plan.sd_reduction <= 1));
    }
  }
  assert.equal(byId("assumption-set-cards").children.length, sets.length);
  maxElements = Math.max(maxElements, doc.querySelectorAll("*").length);
  assert.ok(maxElements < baselineElements + 350, "rendered DOM grows unexpectedly across updates");
};
start();
// Regression probes: each failed input must clear all outputs and recover.
const edges = [
  ["effect-n", ""], ["effect-n", -1], ["effect-n", 1.5], ["effect-n", "1e309"],
  ["effect-n", 4000000000000000], ["effect-k", Number.MAX_SAFE_INTEGER],
  ["effect-person-sd", 1e-200], ["effect-item-sd", 1e-160], ["effect-memory", 1e308],
  ["effect-person-sd", -1], ["effect-item-sd", ""], ["effect-person-sd", "NaN"],
  ["effect-person-sd", "1e-400"], ["effect-item-sd", "-1e-400"]
];
for (const [id, value] of edges) {
  if (id === "effect-person-sd" && value === 1e-200) set("effect-memory", 0);
  set(id, value);
  assert.equal(calculation().status, "invalid_input", `${id}=${value} must be rejected`);
  checkUI();
  start();
  checkUI();
}
for (const value of [1e-140, 1e-5, 1e140]) {
  for (const id of ["effect-person-sd", "effect-item-sd", "effect-memory"]) set(id, value);
  checkUI();
}
set("effect-n", Math.floor(Number.MAX_SAFE_INTEGER / 300));
set("effect-k", Math.floor(Number.MAX_SAFE_INTEGER / 300));
checkUI();
start();

const timings = [];
for (let index = 0; index < 2000; index++) {
  const before = calculation();
  const valid = before.status === "computed_sensitivity";
  const begin = performance.now();
  switch (integer(18)) {
    case 0: set("effect-n", 1 + integer(1000)); break;
    case 1: set("effect-k", 1 + integer(100)); break;
    case 2: case 3: case 4:
      set(["effect-person-sd", "effect-item-sd", "effect-memory"][integer(3)], integer(100) / 100); break;
    case 5:
      byId("effect-memory-adjusted").checked = !byId("effect-memory-adjusted").checked;
      byId("effect-memory-adjusted").dispatchEvent(new dom.window.Event("change", { bubbles: true })); events++; break;
    case 6: set("effect-increase", integer(41) * 5); break;
    case 7: {
      const duplicate = valid && retained.some(saved => fields.every(field => saved[field] === before.inputs[field]));
      byId("keep-effect-assumptions").click(); events++;
      if (valid && retained.length < 3 && !duplicate) {
        const saved = calculation().assumption_comparison.sets.at(-1);
        retained.push({ id: saved.id, ...Object.fromEntries(fields.map(field => [field, before.inputs[field]])) });
        stats.keeps++;
      }
      break;
    }
    case 8: {
      const saved = valid && retained[integer(retained.length)];
      if (saved) {
        doc.querySelector(`[data-remove-set="${saved.id}"]`).click(); events++;
        retained = retained.filter(set => set.id !== saved.id); stats.removes++;
      }
      break;
    }
    case 9: {
      const saved = valid && retained[integer(retained.length)];
      if (saved) {
        doc.querySelector(`[data-use-set="${saved.id}"]`).click(); events++; stats.reuses++;
        assert.equal(calculation().inputs.n_person, before.inputs.n_person);
        assert.equal(calculation().increase_percent, before.increase_percent);
        for (const field of fields) assert.equal(calculation().inputs[field], saved[field]);
      }
      break;
    }
    case 10: { const [id, value] = edges[integer(edges.length)]; set(id, value); break; }
    case 11: start(); break;
    case 12: doc.querySelector(`[data-plan-step="${integer(3)}"]`).click(); events++; break;
    case 13:
      byId("effect-curve").getBoundingClientRect = () => ({ left: 0, width: 640 });
      byId("effect-curve").dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: integer(640) })); events++;
      assert.deepEqual(calculation(), before, "hover mutated selected or kept results"); break;
    case 14: template("one_class_per_condition"); break;
    case 15: template("two_facet_counterbalanced"); break;
    case 16:
      byId("show-overview").click();
      byId(index % 2 ? "resume-effect-planning" : "open-all-tools").click(); events += 2; break;
    case 17:
      if (valid) {
        byId("download-effect-r").click(); events++; stats.downloads++;
        assert.equal(await blob.text(), byId("effect-r-code").textContent);
        assert.equal(doc.querySelectorAll('a[download]').length, 0);
      }
      break;
  }
  timings.push(performance.now() - begin);
  checkUI();
  if ((index + 1) % 500 === 0) console.log(`Stress: ${index + 1}/2000 mixed UI operations passed.`);
}
await new Promise(resolve => setTimeout(resolve, 1100));
assert.equal(objectUrls, 0, "download URLs were not released");

// Reproduce 100 randomized cases plus numeric limits in the Shiny R functions.
const temporary = await mkdtemp(path.join(tmpdir(), "planner-stress-"));
try {
  const base = { n_person: 120, k_per_condition: 15, person_slope_sd: .35, item_slope_sd: .18, memory_moderation: .2, memory_adjusted: false };
  for (const changes of [{ person_slope_sd: 1e-200, memory_moderation: 0 }, { item_slope_sd: 1e-160 },
    { person_slope_sd: 1e155 }, { person_slope_sd: 0, item_slope_sd: 0, memory_moderation: 0 }]) {
    numericSamples.push({ ...base, ...changes });
  }
  const keys = Object.keys(base);
  await writeFile(path.join(temporary, "cases.csv"), keys.join(",") + "\n" + numericSamples.map(input =>
    keys.map(key => typeof input[key] === "boolean" ? input[key] ? "TRUE" : "FALSE" : input[key]).join(",")).join("\n"));
  await writeFile(path.join(temporary, "parity.R"), [
    `source(${JSON.stringify(path.resolve(root, "../design_planner/planner_functions.R"))})`,
    'cases <- read.csv("cases.csv")',
    'values <- vapply(seq_len(nrow(cases)), function(i) tryCatch(do.call(effect_sampling_sd, as.list(cases[i, ])), error = function(e) NA_real_), numeric(1))',
    'write.table(values, "values.csv", row.names = FALSE, col.names = FALSE)'
  ].join("\n"));
  execFileSync("Rscript", ["--vanilla", "parity.R"], { cwd: temporary, timeout: 15000, stdio: "pipe" });
  const rValues = (await readFile(path.join(temporary, "values.csv"), "utf8")).trim().split("\n");
  numericSamples.forEach((input, index) => {
    let result;
    try { result = math.effectProjection(input); } catch { assert.equal(rValues[index], "NA"); return; }
    close(Number(rValues[index]), result.sampling_sd, `R parity sample ${index}`);
  });
  // Exported base-R scripts also cover tiny/large values and the count ceiling.
  template("two_facet_counterbalanced");
  start();
  while (doc.querySelector("[data-remove-set]")) doc.querySelector("[data-remove-set]").click();
  for (const [index, value] of [1e-140, 1e-5, 1e140].entries()) {
    for (const id of ["effect-person-sd", "effect-item-sd", "effect-memory"]) set(id, value);
    byId("keep-effect-assumptions").click();
    if (index === 2) {
      set("effect-n", Math.floor(Number.MAX_SAFE_INTEGER / 300));
      set("effect-k", Math.floor(Number.MAX_SAFE_INTEGER / 300));
    }
    await writeFile(path.join(temporary, "export.R"), byId("effect-r-code").textContent);
    execFileSync("Rscript", ["--vanilla", "export.R"], { cwd: temporary, timeout: 15000, stdio: "pipe" });
    const rows = (await readFile(path.join(temporary, "vocabulary-assumption-comparison.csv"), "utf8")).trim().split("\n");
    const headers = rows.shift().replaceAll('"', '').split(",");
    const sets = calculation().assumption_comparison.sets;
    assert.equal(rows.length, sets.length);
    rows.forEach((line, rowIndex) => {
      const values = line.replaceAll('"', '').split(",");
      const record = Object.fromEntries(headers.map((key, column) => [key, values[column]]));
      for (const [key, plan] of [["baseline_sd", 0], ["sd_more_learners", 1], ["sd_more_words", 2]]) {
        close(Number(record[key]), sets[rowIndex].comparison[plan].sampling_sd, `extreme R export ${index}, ${key}`);
      }
      assert.equal(record.choice, sets[rowIndex].choice);
      assert.equal(Number(record.n_more_learners), sets[rowIndex].comparison[1].n);
      assert.equal(Number(record.total_more_words), 2 * sets[rowIndex].comparison[2].k);
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  dom.window.close();
}
timings.sort((a, b) => a - b);
console.log(JSON.stringify({ seed, projectionCases: 12000, alphaCases: 3000, mixedOperations: 2000,
  regressionProbes: edges.length, events, ...stats, maxElements, baselineElements,
  rParityCases: numericSamples.length, extremeRExports: 3,
  jsdomOperationP95Ms: Number(timings[Math.floor(timings.length * .95)].toFixed(2)),
  elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)) }, null, 2));
