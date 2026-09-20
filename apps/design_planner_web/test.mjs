#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(appRoot, "public");
const readText = name => readFile(path.join(publicRoot, name), "utf8");

const [html, css, appJs, coreJs, claimMathJs, dataJs, claimDataJs, metadataText, wranglerText, headersText] = await Promise.all([
  readText("index.html"),
  readText("styles.css"),
  readText("app.js"),
  readText("design_audit.js"),
  readText("claim_math.js"),
  readText("audit_data.js"),
  readText("claim_data.js"),
  readText("build-meta.json"),
  readFile(path.join(appRoot, "wrangler.jsonc"), "utf8"),
  readText("_headers")
]);

new Function(appJs);
new Function(coreJs);
new Function(claimMathJs);
new Function(dataJs);
new Function(claimDataJs);
assert.ok(css.length > 1000, "stylesheet is unexpectedly empty");

for (const id of [
  "design-form", "template-select", "assignment-mode", "condition-levels",
  "assignment-facets", "sampling-facets", "assignment-replication",
  "facet-rows", "audit-result", "state-card", "issue-list", "formula-output",
  "generalizes-output", "not-generalizes-output", "payload-output",
  "claim-router", "claim-options", "route-target", "aligned-evidence",
  "minimum-reporting", "not-license", "route-gate", "alpha-tool", "effect-tool",
  "reference-grid-tool", "grid-family", "grid-scenario", "grid-n",
  "reference-metrics", "reference-limitations", "reporting-starter",
  "decision-version"
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing UI control #${id}`);
}
for (const asset of [
  "styles.css", "design_audit.js", "claim_math.js", "audit_data.js",
  "claim_data.js", "app.js"
]) {
  assert.ok(html.includes(`./${asset}`), `index.html does not load ${asset}`);
}
assert.ok(html.includes("connect-src 'none'"), "CSP must keep the static audit offline");
assert.match(html, /name=["']robots["'][^>]*noindex/i, "review build must request search-engine noindex");
assert.doesNotMatch(html, /(?:src|href)=["']https?:/i, "runtime asset must not use an external origin");
assert.match(headersText, /X-Robots-Tag:\s*noindex, nofollow, noarchive/i);
assert.match(headersText, /Referrer-Policy:\s*no-referrer/i);
assert.match(headersText, /frame-ancestors 'none'/i);

const context = { console, setTimeout, clearTimeout };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(coreJs, context, { filename: "design_audit.js" });
vm.runInContext(claimMathJs, context, { filename: "claim_math.js" });
vm.runInContext(dataJs, context, { filename: "audit_data.js" });
vm.runInContext(claimDataJs, context, { filename: "claim_data.js" });
const core = context.DesignAudit;
const claimMath = context.ClaimMath;
const fixtures = context.DesignAuditFixtures.fixtures;
const registry = context.DesignAuditRegistry;
const targetRegistry = context.InferentialTargetRegistry;
const claimMathFixtures = context.ClaimMathFixtures;
const referenceGrids = context.ReferenceGridRegistry;
const decisionRules = context.DecisionRulesRegistry;
const goldenFixtures = context.GoldenTestFixtures;
assert.equal(core.SCHEMA_VERSION, "1.0.0");
assert.equal(claimMath.SCHEMA_VERSION, "1.0.0");
assert.equal(targetRegistry.branches.length, 4);
assert.equal(referenceGrids.schema_version, "1.0.0");
assert.equal(referenceGrids.families.length, 2);
assert.equal(
  referenceGrids.families.reduce((sum, family) => sum + family.rows.length, 0),
  70,
  "reference-grid bundle must contain all 70 published rows"
);
assert.ok(referenceGrids.families.every(family => family.lookup_mode === "exact_only"));
assert.equal(decisionRules.schema_version, "1.0.0");
assert.deepEqual(
  Array.from(decisionRules.pathways, pathway => pathway.id),
  ["browser_static", "short_r_api", "offline_async"]
);
assert.equal(decisionRules.calculations.length, 10);
assert.equal(
  decisionRules.validation_states.filter(state => state.can_publish_validated_numeric).length,
  1,
  "only Within validated envelope may publish a validated numeric result"
);
assert.equal(
  decisionRules.pathways.find(pathway => pathway.id === "short_r_api").implementation_status,
  "not_implemented_no_current_public_dependency"
);
assert.ok(
  decisionRules.pathways.find(pathway => pathway.id === "browser_static")
    .prohibited_work.includes("Monte Carlo simulation")
);
assert.equal(goldenFixtures.design_audit.length, 7);
assert.equal(goldenFixtures.claim_math.alpha_expectation.length, 3);
assert.equal(goldenFixtures.claim_math.effect_projection.length, 5);
assert.equal(goldenFixtures.reference_grid_sentinels.length, 3);
assert.deepEqual(
  Array.from(targetRegistry.branches, branch => branch.number),
  [1, 2, 3, 4],
  "claim router must preserve the manuscript's four-branch order"
);
assert.deepEqual(Array.from(registry.validated_envelopes), [], "public validation registry must start empty");

for (const fixture of claimMathFixtures.alpha_expectation) {
  const result = claimMath.alphaExpectation(fixture.inputs);
  assert.ok(Math.abs(result.alpha - fixture.expected.alpha) < 1e-12, fixture.id);
  assert.equal(result.floor_ceiling_flag, fixture.expected.floor_ceiling_flag, fixture.id);
  assert.equal(result.memory_sorting_flag, fixture.expected.memory_sorting_flag, fixture.id);
}
for (const fixture of claimMathFixtures.effect_projection) {
  const result = claimMath.effectProjection(fixture.inputs);
  assert.ok(Math.abs(result.sampling_sd - fixture.expected.sampling_sd) < 1e-12, fixture.id);
  assert.equal(result.bottleneck, fixture.expected.bottleneck, fixture.id);
}

const goldenAuditById = new Map(goldenFixtures.design_audit.map(fixture => [fixture.id, fixture]));
for (const fixture of fixtures) {
  const result = core.auditDesignGraph(fixture.design, fixture.validated_ids);
  const golden = goldenAuditById.get(fixture.id);
  assert.equal(result.state, golden.state, `${fixture.id}: R-generated golden state`);
  assert.equal(result.can_compute, golden.can_compute, `${fixture.id}: R-generated golden gate`);
  assert.deepEqual(
    Array.from(result.issues, issue => issue.code),
    Array.from(golden.issue_codes),
    `${fixture.id}: R-generated golden reason codes`
  );
  assert.equal(result.formula_suggestion, golden.formula_suggestion, `${fixture.id}: R-generated golden formula`);
}

for (const golden of goldenFixtures.claim_math.alpha_expectation) {
  const source = claimMathFixtures.alpha_expectation.find(fixture => fixture.id === golden.id);
  const result = claimMath.alphaExpectation(source.inputs);
  assert.ok(Math.abs(result.alpha - golden.alpha) < 1e-12, `${golden.id}: R-generated alpha golden`);
}
for (const golden of goldenFixtures.claim_math.effect_projection) {
  const source = claimMathFixtures.effect_projection.find(fixture => fixture.id === golden.id);
  const result = claimMath.effectProjection(source.inputs);
  assert.ok(Math.abs(result.sampling_sd - golden.sampling_sd) < 1e-12, `${golden.id}: R-generated effect golden`);
  assert.equal(result.bottleneck, golden.bottleneck, `${golden.id}: R-generated bottleneck golden`);
}

const results = new Map(fixtures.map(fixture => [
  fixture.id,
  core.auditDesignGraph(fixture.design, registry.validated_envelopes)
]));
assert.equal(results.get("hierarchical_crossed_validated").state, "Estimable but fragile");
assert.equal(results.get("one_class_per_condition").state, "Not identifiable");
assert.equal(results.get("spatial_prefecture").state, "Outside supported model class");
assert.ok(
  [...results.values()].every(result => result.state !== "Within validated envelope"),
  "an empty registry must prevent validated-envelope promotion"
);

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
dom.window.structuredClone = structuredClone;
dom.window.eval(coreJs);
dom.window.eval(claimMathJs);
dom.window.eval(dataJs);
dom.window.eval(claimDataJs);
dom.window.eval(await readText("simulation_data.js"));
dom.window.eval(await readText("study_plan.js"));
dom.window.eval(await readText("simulation_results.js"));
dom.window.eval(appJs);

const domById = id => dom.window.document.getElementById(id);
async function checkRExport() {
  if (!process.argv.includes("--check-r")) return;
  const directory = await mkdtemp(path.join(tmpdir(), "planner-r-export-"));
  try {
    await writeFile(path.join(directory, "comparison.R"), domById("effect-r-code").textContent);
    execFileSync("Rscript", ["--vanilla", "comparison.R"], { cwd: directory, timeout: 15000, stdio: "pipe" });
    const csv = (await readFile(path.join(directory, "vocabulary-comparison.csv"), "utf8")).trim().split("\n");
    const expected = JSON.parse(domById("payload-output").textContent).inferential_route.calculation.comparison;
    for (let index = 0; index < 3; index++) {
      const row = csv[index + 1].split(",");
      assert.equal(Number(row[1]), expected[index].n);
      assert.equal(Number(row[2]), expected[index].k);
      assert.ok(Math.abs(Number(row[4]) - expected[index].sampling_sd) < 1e-12, "downloaded R SD must reproduce the browser");
      if (expected[index].sd_reduction === null) assert.equal(row[5], "NA");
      else assert.ok(Math.abs(Number(row[5]) - expected[index].sd_reduction) < 1e-12);
    }
    const curve = (await readFile(path.join(directory, "vocabulary-sensitivity-curve.csv"), "utf8")).trim().split("\n");
    assert.equal(curve.length, 42);
    const inputs = JSON.parse(domById("payload-output").textContent).inferential_route.calculation.inputs;
    for (const line of curve.slice(1)) {
      const [increase, n, words, learnerSd, wordSd] = line.split(",").map(Number);
      assert.equal(n, Math.ceil(inputs.n_person * (100 + increase) / 100));
      assert.equal(words, 2 * Math.ceil(inputs.k_per_condition * (100 + increase) / 100));
      assert.ok(Math.abs(learnerSd - claimMath.effectProjection({ ...inputs, n_person: n }).sampling_sd) < 1e-12);
      assert.ok(Math.abs(wordSd - claimMath.effectProjection({ ...inputs, k_per_condition: words / 2 }).sampling_sd) < 1e-12);
    }
    assert.equal((await readFile(path.join(directory, "vocabulary-sensitivity.pdf"))).subarray(0, 4).toString(), "%PDF");
    const held = JSON.parse(domById("payload-output").textContent).inferential_route.calculation.assumption_comparison;
    if (held.sets.length) {
      const lines = (await readFile(path.join(directory, "vocabulary-assumption-comparison.csv"), "utf8")).trim().split("\n");
      const headers = lines[0].replaceAll('"', '').split(",");
      assert.equal(lines.length, held.sets.length + 1);
      for (const [index, set] of held.sets.entries()) {
        const values = lines[index + 1].replaceAll('"', '').split(",");
        const row = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
        for (const field of ["person_slope_sd", "item_slope_sd", "memory_moderation"]) assert.equal(Number(row[field]), set[field]);
        assert.equal(Number(row.set_id), set.id);
        assert.equal(row.memory_adjusted, set.memory_adjusted ? "TRUE" : "FALSE");
        assert.equal(Number(row.n_person), held.n_person);
        assert.equal(Number(row.k_per_condition), held.k_per_condition);
        assert.equal(Number(row.increase_percent), held.increase_percent);
        assert.equal(Number(row.n_more_learners), set.comparison[1].n);
        assert.equal(Number(row.total_more_words), 2 * set.comparison[2].k);
        for (const [column, plan] of [["baseline_sd", 0], ["sd_more_learners", 1], ["sd_more_words", 2]]) {
          assert.ok(Math.abs(Number(row[column]) - set.comparison[plan].sampling_sd) < 1e-12);
        }
        for (const [column, plan] of [["reduction_more_learners", 1], ["reduction_more_words", 2]]) {
          if (set.comparison[plan].sd_reduction === null) assert.equal(row[column], "NA");
          else assert.ok(Math.abs(Number(row[column]) - set.comparison[plan].sd_reduction) < 1e-12);
        }
        assert.equal(row.choice, set.choice);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const selectTemplate = id => {
  const select = domById("template-select");
  select.value = id;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  return domById("result-title").textContent;
};

assert.equal(domById("result-title").textContent, "Estimable but fragile");
assert.equal(domById("decision-version").textContent, "1.0.0");
assert.match(domById("formula-output").textContent, /prefecture/);
assert.equal(dom.window.document.querySelectorAll('input[name="claim-target"]').length, 4);
assert.match(domById("route-target").textContent, /Score reliability/);
assert.equal(domById("alpha-value").textContent, "0.726");
assert.equal(domById("claim-router").hidden, true, "the landing page must not show all research tools");
assert.equal(domById("design-details").hidden, true);
domById("open-all-tools").click();
assert.equal(domById("claim-router").hidden, false);
assert.equal(dom.window.document.body.dataset.mode, "advanced");
assert.match(domById("reporting-starter").textContent, /exact \[time/);
assert.equal(
  JSON.parse(domById("payload-output").textContent).design.validation_id,
  undefined,
  "example fixtures must not inject a validation ID into a user audit"
);
assert.equal(selectTemplate("one_class_per_condition"), "Not identifiable");
assert.match(domById("issue-list").textContent, /assignment_not_replicated/);

domById("assignment-replication").value = "2, 2";
domById("evaluate-design").click();
assert.equal(
  domById("result-title").textContent,
  "Estimable but fragile",
  "restoring assignment replication should clear the fatal identification state"
);

assert.equal(selectTemplate("spatial_prefecture"), "Outside supported model class");
assert.match(domById("issue-list").textContent, /unsupported_spatial/);
assert.match(domById("formula-output").textContent, /Suppressed/);
assert.equal(selectTemplate("omitted_item_slope"), "Estimable but fragile");
assert.match(domById("not-generalizes-output").textContent, /item/);
assert.equal(selectTemplate("cyclic_hierarchy"), "Not identifiable");
assert.match(domById("issue-list").textContent, /parent_cycle/);

const selectClaim = id => {
  const radio = dom.window.document.querySelector(`input[name="claim-target"][value="${id}"]`);
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
};

selectTemplate("hierarchical_crossed_validated");
selectClaim("condition_effect");
assert.equal(domById("route-gate").dataset.gate, "caution");
assert.equal(domById("reference-grid-tool").hidden, false);
assert.equal(domById("qualitative-tool").hidden, true);
assert.match(domById("grid-row-title").textContent, /Balanced lists/);
assert.match(domById("reference-metrics").textContent, /31\.4%/);
assert.match(domById("reference-limitations").textContent, /not a transferable power estimate/);
assert.equal(
  JSON.parse(domById("payload-output").textContent)
    .inferential_route.calculation.applied_to_current_design,
  false
);
assert.equal(
  JSON.parse(domById("payload-output").textContent)
    .inferential_route.execution_pathway,
  "browser_static"
);

domById("grid-scenario").value = "partial_only_effect";
domById("grid-scenario").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.match(domById("grid-row-title").textContent, /mainly creates partial knowledge/);
assert.match(domById("reference-metrics").textContent, /79\.8%/);

domById("grid-family").value = "sim07_two_facet";
domById("grid-family").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(domById("grid-k-field").hidden, false);
assert.equal(domById("grid-model-field").hidden, false);
assert.equal(domById("grid-scoring-field").hidden, true);
assert.match(domById("reference-metrics").textContent, /100\.0%/);
assert.match(domById("reference-metrics").textContent, /Not in snapshot/);

selectClaim("effect_generalizability");
assert.equal(domById("route-gate").dataset.gate, "blocked");
assert.equal(domById("effect-value").textContent, "Blocked");
assert.equal(domById("effect-n").disabled, true);

selectTemplate("two_facet_counterbalanced");
assert.equal(domById("route-gate").dataset.gate, "caution");
assert.equal(domById("effect-value").textContent, "0.0493");
assert.equal(domById("effect-bottleneck").textContent, "both");
assert.equal(domById("effect-n").disabled, false);

// Exercise the complete planning route, including the memory-adjustment bug.
assert.equal(domById("resume-effect-planning").hidden, true);
domById("start-effect-planning").click();
assert.equal(domById("resume-effect-planning").hidden, false);
assert.match(domById("start-effect-planning").textContent, /Restart with example inputs/);
assert.equal(dom.window.document.body.dataset.mode, "guided");
assert.equal(domById("effect-tool-title").getAttribute("aria-level"), "2");
assert.equal(domById("plan-setup").hidden, false);
assert.equal(domById("plan-compare").hidden, true);
assert.equal(domById("reporting-panel").hidden, true);
dom.window.document.querySelector('[data-plan-step="1"]').click();
assert.equal(domById("plan-setup").hidden, true);
assert.equal(domById("plan-compare").hidden, false);
assert.equal(dom.window.document.activeElement.id, "comparison-title");
assert.match(domById("learner-curve").getAttribute("d"), /^M/);
assert.doesNotMatch(domById("word-curve").getAttribute("d"), /NaN|Infinity/);
assert.equal(domById("template-select").value, "two_facet_counterbalanced");
assert.equal(domById("design-details").open, false);
assert.equal(domById("effect-comparison-rows").children.length, 3);
assert.match(domById("effect-takeaway").textContent, /Under these assumptions, adding learners/);
assert.match(domById("effect-interpretation").textContent, /240 learners .*15\.0% lower sampling SD; 60 words .*11\.8% lower sampling SD/);
const setPlanningInput = (id, value) => {
  domById(id).value = String(value);
  domById(id).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
for (const [id, value] of [["effect-k", 30], ["effect-person-sd", .05],
  ["effect-item-sd", .15], ["effect-memory", .65]]) setPlanningInput(id, value);
assert.equal(domById("effect-bottleneck").textContent, "participants");
await checkRExport();
domById("effect-memory-adjusted").checked = true;
domById("effect-memory-adjusted").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(domById("effect-bottleneck").textContent, "items");
assert.equal(domById("effect-value").textContent, "0.0199");
assert.match(domById("effect-takeaway").textContent, /adding words reduces/);
const comparison = JSON.parse(domById("payload-output").textContent).inferential_route.calculation.comparison;
assert.ok(Math.abs(comparison[1].sampling_sd - Math.sqrt(.05 ** 2 / 240 + .15 ** 2 / 60)) < 1e-12);
assert.ok(Math.abs(comparison[2].sampling_sd - Math.sqrt(.05 ** 2 / 120 + .15 ** 2 / 120)) < 1e-12);
assert.match(domById("reporting-starter").textContent, /memory moderation assumed fully accounted for/);
await checkRExport();

// A selected increase drives the chart, exact table, report, JSON and R together.
// A live update must not remove the active comparison from the layout, even
// temporarily: real browsers clamp the scroll when the document collapses.
const comparisonVisibility = new dom.window.MutationObserver(() => {});
comparisonVisibility.observe(domById("effect-comparison"), { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
domById("effect-increase").focus();
setPlanningInput("effect-increase", 25);
assert.equal(domById("effect-comparison").hidden, false);
assert.equal(dom.window.document.activeElement.id, "effect-increase");
assert.ok(comparisonVisibility.takeRecords().every(record => record.oldValue === null), "changing the slider must not hide and redisplay the comparison");
comparisonVisibility.disconnect();
assert.ok(domById("effect-increase").compareDocumentPosition(domById("effect-interpretation")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
  "changing explanations must follow the slider in reading and layout order");
let selected = JSON.parse(domById("payload-output").textContent).inferential_route.calculation;
assert.equal(selected.increase_percent, 25);
assert.equal(selected.comparison[1].n, 150);
assert.equal(selected.comparison[2].k, 38, "37.5 words per condition must round up");
assert.match(domById("effect-r-code").textContent, /increase_percent <- 25/);
assert.match(domById("curve-word-counts").textContent, /76 total words/);
assert.match(domById("effect-interpretation").textContent, /150 learners .*76 words/);
assert.equal(domById("effect-increase").getAttribute("aria-valuetext"), "25% increase: 150 learners or 76 total words, with the other count unchanged.");
await checkRExport();
const selectedTakeaway = domById("effect-takeaway").textContent;
const selectedAnswer = domById("effect-interpretation").textContent;
const curveSvg = domById("effect-curve");
curveSvg.getBoundingClientRect = () => ({ left: 0, width: 640 });
curveSvg.dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: 624 }));
assert.match(domById("curve-preview-label").textContent, /Preview: \+200%/);
assert.equal(domById("effect-increase").value, "25", "hover must not replace the selected plan");
assert.match(domById("effect-increase").getAttribute("aria-valuetext"), /^25% increase/, "hover must not change the accessible selected value");
assert.equal(domById("effect-takeaway").textContent, selectedTakeaway);
assert.equal(domById("effect-interpretation").textContent, selectedAnswer);
assert.match(domById("comparison-selection").textContent, /\+25%/);
domById("review-effect-assumptions").click();
assert.equal(domById("plan-setup").hidden, false);
assert.equal(domById("effect-assumptions").open, true);
assert.equal(dom.window.document.activeElement.id, "effect-person-sd");
assert.equal(domById("effect-n").value, "120");
assert.equal(domById("effect-k").value, "30");
assert.equal(domById("effect-increase").value, "25");
dom.window.document.querySelector('[data-plan-step="1"]').click();
curveSvg.dispatchEvent(new dom.window.MouseEvent("click", { clientX: 64 }));
assert.equal(domById("effect-increase").value, "0");
assert.match(domById("effect-takeaway").textContent, /No increase is selected/);
assert.match(domById("effect-interpretation").textContent, /Move the slider/);
setPlanningInput("effect-increase", 100);
dom.window.document.querySelector('[data-plan-step="2"]').click();
assert.equal(domById("plan-export").hidden, false);
assert.equal(domById("reporting-panel").hidden, false);
let downloadedBlob;
let downloadedName;
dom.window.Blob = Blob;
dom.window.URL.createObjectURL = blob => { downloadedBlob = blob; return "blob:test"; };
dom.window.URL.revokeObjectURL = () => {};
dom.window.document.addEventListener("click", event => {
  if (event.target.tagName === "A" && event.target.download) {
    downloadedName = event.target.download;
    event.preventDefault();
  }
});
domById("download-effect-r").click();
assert.equal(downloadedName, "vocabulary-design-sensitivity.R");
assert.equal(await downloadedBlob.text(), domById("effect-r-code").textContent);

for (const [id, value] of [["effect-person-sd", ""], ["effect-item-sd", -1], ["effect-n", 1.5]]) {
  const previous = domById(id).value;
  setPlanningInput(id, value);
  assert.equal(domById("effect-value").textContent, "Invalid");
  assert.equal(domById("effect-comparison").hidden, true);
  assert.equal(domById("effect-comparison-rows").children.length, 0);
  assert.equal(domById("effect-error").hidden, false);
  assert.equal(domById(id).getAttribute("aria-invalid"), "true");
  assert.ok(domById(id).getAttribute("aria-describedby").split(" ").includes("effect-error"));
  if (id === "effect-person-sd") assert.match(domById(id).getAttribute("aria-describedby"), /person-sd-help/);
  assert.equal(domById("download-effect-r").disabled, true);
  assert.equal(domById("effect-r-code").textContent, "");
  assert.equal(domById("effect-takeaway").textContent, "");
  assert.equal(domById("plan-setup").hidden, false);
  setPlanningInput(id, previous);
  assert.doesNotMatch(domById(id).getAttribute("aria-describedby") || "", /effect-error/, "a recovered input must not announce an obsolete error");
  if (id === "effect-person-sd") assert.equal(domById(id).getAttribute("aria-describedby"), "person-sd-help");
}
setPlanningInput("effect-person-sd", 0);
setPlanningInput("effect-item-sd", 0);
assert.match(domById("effect-interpretation").textContent, /does not imply perfect precision/);
assert.doesNotMatch(domById("effect-comparison-rows").textContent, /NaN|Infinity/);
await checkRExport();

// Equal contributions tie at doubling. Rounded expansions can reverse the
// ranking suggested by the original variance shares, so compare actual plans.
for (const [id, value] of [["effect-n", 60], ["effect-k", 30],
  ["effect-person-sd", .2], ["effect-item-sd", .2]]) setPlanningInput(id, value);
assert.match(domById("effect-takeaway").textContent, /both expansions reduce variation equally/);
for (const [id, value] of [["effect-n", 20], ["effect-k", 1],
  ["effect-person-sd", 1], ["effect-item-sd", .3], ["effect-increase", 5]]) setPlanningInput(id, value);
assert.match(domById("effect-takeaway").textContent, /adding words reduces/);
assert.match(domById("effect-interpretation").textContent, /21 learners .*4 words/);
assert.match(domById("reporting-starter").textContent, /adding words reduces/);

// Keep independent assumption sets while reusing common counts and the same
// expansion. The live chart and saved sets must not silently overwrite each other.
domById("start-effect-planning").click();
dom.window.document.querySelector('[data-plan-step="1"]').click();
const keptComparison = () => JSON.parse(domById("payload-output").textContent).inferential_route.calculation.assumption_comparison;
const keepSet = () => domById("keep-effect-assumptions").click();
keepSet();
assert.equal(domById("assumption-comparison").open, true);
assert.equal(keptComparison().sets.length, 1);
assert.equal(domById("keep-effect-assumptions").disabled, true, "identical assumptions cannot be kept twice");
assert.match(domById("assumption-comparison-summary").textContent, /One set kept/);
setPlanningInput("effect-item-sd", .6);
keepSet();
assert.equal(keptComparison().sets[0].item_slope_sd, .18, "editing must preserve the first set");
assert.deepEqual(keptComparison().sets.map(set => set.choice), ["learners", "words"]);
assert.match(domById("assumption-comparison-summary").textContent, /preferred expansion changes/);
domById("effect-memory-adjusted").checked = true;
domById("effect-memory-adjusted").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
keepSet();
assert.equal(keptComparison().sets.length, 3, "the adjustment toggle is part of an assumption set");
setPlanningInput("effect-person-sd", .4);
assert.equal(domById("keep-effect-assumptions").disabled, true);
domById("keep-effect-assumptions").dispatchEvent(new dom.window.Event("click"));
assert.equal(keptComparison().sets.length, 3, "the handler enforces the capacity too");
for (const [id, value] of [["effect-n", 125], ["effect-k", 17], ["effect-increase", 25]]) setPlanningInput(id, value);
for (const set of keptComparison().sets) {
  assert.equal(set.comparison[0].n, 125);
  assert.equal(set.comparison[0].k, 17);
  assert.equal(set.comparison[1].n, 157);
  assert.equal(set.comparison[2].k, 22);
  assert.ok(Math.abs(set.comparison[1].sampling_sd - Math.sqrt((set.person_slope_sd ** 2 + (set.memory_adjusted ? 0 : set.memory_moderation ** 2)) / 157 + set.item_slope_sd ** 2 / 34)) < 1e-12);
}
const selectedSets = JSON.stringify(keptComparison());
const beforeOverview = domById("effect-r-code").textContent;
domById("show-overview").click();
domById("resume-effect-planning").click();
assert.equal(domById("plan-compare").hidden, false);
assert.equal(dom.window.document.activeElement.id, "comparison-title");
assert.equal(domById("effect-n").value, "125");
assert.equal(domById("effect-k").value, "17");
assert.equal(domById("effect-increase").value, "25");
assert.equal(JSON.stringify(keptComparison()), selectedSets);
assert.equal(domById("effect-r-code").textContent, beforeOverview, "resuming preserves current assumptions and the complete export");
assert.equal(domById("effect-takeaway").getAttribute("aria-level"), "3");
assert.equal(domById("assumption-set-title-1").getAttribute("aria-level"), "4");
domById("open-all-tools").click();
assert.equal(domById("comparison-title").getAttribute("aria-level"), "4", "advanced tools retain their enclosing heading hierarchy");
domById("resume-effect-planning").click();
assert.equal(domById("comparison-title").getAttribute("aria-level"), "2");
curveSvg.dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: 624 }));
assert.equal(JSON.stringify(keptComparison()), selectedSets, "hover cannot change held-set comparisons");
assert.match(domById("assumption-export-note").textContent, /Includes 3 kept/);
assert.match(domById("reporting-starter").textContent, /Set 1:.*Set 2:.*Set 3:/);
await checkRExport();
domById("assumption-set-cards").querySelector('[data-use-set="1"]').click();
assert.equal(dom.window.document.activeElement.id, "effect-increase", "using a set returns keyboard control to the chart slider");
assert.equal(domById("effect-item-sd").value, "0.18");
assert.equal(domById("effect-memory-adjusted").checked, false);
assert.equal(domById("effect-n").value, "125");
assert.equal(domById("effect-increase").value, "25");
domById("assumption-set-cards").querySelector('[data-remove-set="2"]').click();
assert.deepEqual(keptComparison().sets.map(set => set.id), [1, 3]);
assert.equal(dom.window.document.activeElement.dataset.removeSet, "3", "removing a middle set focuses the next set");
domById("assumption-set-cards").querySelector('[data-remove-set="3"]').click();
assert.equal(dom.window.document.activeElement.dataset.removeSet, "1", "removing the last set in a list focuses its neighbor");
while (domById("assumption-set-cards").querySelector("[data-remove-set]")) {
  domById("assumption-set-cards").querySelector("[data-remove-set]").click();
}
assert.equal(keptComparison().sets.length, 0);
assert.equal(dom.window.document.activeElement.id, "edit-comparison-assumptions", "removing the final set leaves a useful keyboard target");
assert.doesNotMatch(domById("effect-r-code").textContent, /assumption_sets <-/);

// Summary states and R agreement for ties, zero variation and no increase.
domById("effect-memory-adjusted").checked = true;
for (const [id, value] of [["effect-n", 60], ["effect-k", 30], ["effect-increase", 100],
  ["effect-person-sd", .2], ["effect-item-sd", .2]]) setPlanningInput(id, value);
keepSet();
setPlanningInput("effect-person-sd", .4);
setPlanningInput("effect-item-sd", .4);
keepSet();
assert.match(domById("assumption-comparison-summary").textContent, /equal reductions in every kept set/);
await checkRExport();
setPlanningInput("effect-n", 20);
setPlanningInput("effect-k", 1);
setPlanningInput("effect-increase", 5);
assert.match(domById("assumption-comparison-summary").textContent, /Adding words reduces variation more in every kept set/);
setPlanningInput("effect-person-sd", 0);
setPlanningInput("effect-item-sd", 0);
keepSet();
assert.match(domById("assumption-comparison-summary").textContent, /zero included variation/);
assert.equal(keptComparison().sets[2].comparison[1].sd_reduction, null);
await checkRExport();
setPlanningInput("effect-increase", 0);
assert.match(domById("assumption-comparison-summary").textContent, /No increase is selected/);
await checkRExport();
domById("assumption-set-cards").querySelector('[data-remove-set="6"]').click();
for (const [id, value] of [["effect-n", 60], ["effect-k", 30], ["effect-increase", 100],
  ["effect-person-sd", .4], ["effect-item-sd", .2]]) setPlanningInput(id, value);
keepSet();
assert.match(domById("assumption-comparison-summary").textContent, /Some kept sets give equal reductions; others favor more learners/);
setPlanningInput("effect-n", "");
assert.equal(domById("assumption-set-cards").children.length, 0);
assert.equal(domById("keep-effect-assumptions").disabled, true);
assert.equal(keptComparison(), undefined);
setPlanningInput("effect-n", 60);
assert.equal(keptComparison().sets.length, 3, "invalid input must not discard kept assumptions");
while (domById("assumption-set-cards").querySelector("[data-remove-set]")) {
  domById("assumption-set-cards").querySelector("[data-remove-set]").click();
}
domById("start-effect-planning").click();
setPlanningInput("effect-memory", 0);
setPlanningInput("effect-item-sd", 0);
setPlanningInput("effect-person-sd", 1e-5);
assert.match(domById("effect-value").textContent, /e-/);
assert.ok(Number(domById("effect-value").textContent) > 0);
setPlanningInput("effect-person-sd", "1e-400");
assert.equal(domById("effect-value").textContent, "Invalid");
assert.match(domById("effect-error").textContent, /nonzero value is too small to represent/);
setPlanningInput("effect-person-sd", "0e-400");
assert.equal(domById("effect-value").textContent, "0.0000", "an actual zero remains valid");
setPlanningInput("effect-person-sd", 1e-152);
keepSet();
setPlanningInput("effect-person-sd", .35);
setPlanningInput("effect-memory", .2);
setPlanningInput("effect-n", 1e9); // Current inputs are valid; the kept tiny set underflows.
assert.equal(domById("effect-value").textContent, "Invalid");
assert.match(domById("effect-error").textContent, /Kept Set .*too small/);
assert.equal(domById("effect-comparison").hidden, true);
assert.equal(domById("effect-takeaway").textContent, "");
assert.equal(domById("keep-effect-assumptions").disabled, true);
setPlanningInput("effect-n", 120);
assert.equal(keptComparison().sets.length, 1);
domById("assumption-set-cards").querySelector("[data-remove-set]").click();
setPlanningInput("effect-n", 4000000000000000);
assert.match(domById("effect-error").textContent, /count is too large/);
assert.equal(domById("effect-takeaway").textContent, "");
domById("start-effect-planning").click();
domById("review-effect-design").click();
assert.equal(domById("design-details").open, true);

// Explicit evaluation reveals its result; automatic checks preserve editing focus.
let auditResultScrolls = 0;
domById("result-title").scrollIntoView = () => { auditResultScrolls += 1; };
domById("evaluate-design").click();
assert.equal(dom.window.document.activeElement.id, "result-title", "Evaluate structure must focus its result");
assert.equal(auditResultScrolls, 1, "Evaluate structure must bring its result into view");
assert.equal(domById("result-title").textContent, "Estimable but fragile");
domById("condition-levels").focus();
domById("condition-levels").value = "1";
domById("condition-levels").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await new Promise(resolve => dom.window.setTimeout(resolve, 180));
assert.equal(domById("result-title").textContent, "Not identifiable");
assert.equal(dom.window.document.activeElement.id, "condition-levels", "automatic evaluation must not interrupt editing");
assert.equal(auditResultScrolls, 1, "automatic evaluation must not scroll to the result");
domById("evaluate-design").click();
assert.equal(dom.window.document.activeElement.id, "result-title", "blocked results must also be revealed");
assert.equal(auditResultScrolls, 2);
delete domById("result-title").scrollIntoView;

selectTemplate("one_class_per_condition");
assert.equal(domById("route-gate").dataset.gate, "blocked");
assert.equal(domById("effect-value").textContent, "Blocked");
assert.equal(domById("effect-comparison").hidden, true);
assert.equal(domById("effect-comparison-rows").children.length, 0);
assert.equal(domById("download-effect-r").disabled, true);
assert.equal(domById("effect-takeaway").textContent, "");
assert.equal(domById("assumption-set-cards").children.length, 0);
assert.equal(domById("keep-effect-assumptions").disabled, true);

selectClaim("condition_effect");
assert.equal(domById("route-gate").dataset.gate, "blocked");
assert.match(domById("grid-design-note").textContent, /cannot repair this block/);
assert.ok(domById("reference-metrics").children.length > 0, "blocked designs may browse, but not apply, a reference row");
domById("show-overview").click();
domById("resume-effect-planning").click();
assert.equal(domById("template-select").value, "one_class_per_condition", "resume must not replace a blocked design with the example");
assert.equal(domById("effect-value").textContent, "Blocked");
assert.equal(domById("plan-setup").hidden, false);
assert.equal(domById("download-effect-r").disabled, true);

selectClaim("construct_scoring");
assert.equal(domById("route-gate").dataset.gate, "available");
assert.match(domById("qualitative-tool-message").textContent, /response criteria/);
assert.match(domById("not-license").textContent, /Construct validity/);

selectClaim("person_score");
domById("alpha-rbar").value = "1";
domById("alpha-rbar").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
assert.equal(domById("alpha-value").textContent, "Invalid");
domById("alpha-rbar").value = "0.15";
domById("alpha-rbar").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
assert.equal(domById("alpha-value").textContent, "0.726");
domById("alpha-rbar").value = "";
domById("alpha-rbar").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
assert.equal(domById("alpha-value").textContent, "Invalid", "missing correlation must not become zero");

selectTemplate("hierarchical_crossed_validated");
const initialFacetCount = dom.window.document.querySelectorAll("#facet-rows tr").length;
domById("add-facet").click();
assert.equal(dom.window.document.querySelectorAll("#facet-rows tr").length, initialFacetCount + 1);
dom.window.document.querySelector("#facet-rows tr:last-child .remove-facet").click();
assert.equal(dom.window.document.querySelectorAll("#facet-rows tr").length, initialFacetCount);

// Scoring and extended model specifications share the public UI/export path.
domById("start-effect-planning").click();
const studyPlan = dom.window.StudyPlan;
const noConditionSlope = structuredClone(fixtures.find(f => f.id === "two_facet_counterbalanced").design);
noConditionSlope.facets.find(f => f.id === "participant").slope = "none";
const timePlan = studyPlan.modelPlan(noConditionSlope, { can_compute: true }, [{ name: "time", type: "numeric", levels: 2, interaction: false, within: ["participant"], slopes: ["participant"] }]);
assert.match(timePlan.formula, /diag\(1 \+ time \| participant\)/, "a time slope does not require a condition slope");
const fixedContextOnly = structuredClone(noConditionSlope);
for (const facet of fixedContextOnly.facets) facet.model_role = "fixed";
assert.equal(studyPlan.modelPlan(fixedContextOnly, { can_compute: true }, []).formula, null);
const scoreBase = { target: 30, correct: 15, fillers: 10, filler_correct: 10, known: 0, known_correct: 0, policy: "all_targets" };
assert.deepEqual(Array.from(studyPlan.scoreComparison(scoreBase), r => r.proportion), [.5, .5, .625]);
assert.equal(studyPlan.scoreComparison({ ...scoreBase, known: 30, known_correct: 15 })[1].proportion, null);
assert.throws(() => studyPlan.scoreComparison({ ...scoreBase, known: 29, known_correct: 0 }), /overlap/);
assert.throws(() => studyPlan.scoreComparison({ ...scoreBase, fillers: NaN }), /whole counts/);
assert.throws(() => studyPlan.scoreComparison({ ...scoreBase, correct: 31 }), /overlap/);
const setStudyField = async (id, value) => {
  domById(id).value = value;
  domById(id).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 150));
};
const studyPayload = () => JSON.parse(domById("payload-output").textContent);
const studySd = studyPayload().inferential_route.calculation.result.sampling_sd;
await setStudyField("score-fillers", "20");
assert.equal(studyPayload().inferential_route.calculation.result.sampling_sd, studySd, "fillers cannot inflate target precision");
assert.equal(studyPayload().score_plan.results[2].proportion, .5);
await setStudyField("score-policy", "unknown_only");
assert.equal(studyPayload().inferential_route.gate.status, "blocked");
assert.equal(domById("download-effect-r").disabled, true);
await setStudyField("score-known", "30"); // inconsistent until known correct count is supplied
assert.equal(domById("download-score-r").disabled, true);
await setStudyField("score-known-correct", "15");
assert.match(domById("score-rows").textContent, /Undefined/);
assert.equal(domById("download-score-r").disabled, false);
const zeroEligibleR = studyPlan.scoreR(studyPayload().score_plan.inputs);
const alphaRadioForStudy = [...domById("claim-options").querySelectorAll("input")][0];
alphaRadioForStudy.checked = true;
alphaRadioForStudy.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(studyPayload().inferential_route.calculation.status, "blocked_by_score_definition");
assert.equal(domById("alpha-value").textContent, "Unavailable");
await setStudyField("score-target", "");
assert.equal(domById("download-score-r").disabled, true);
assert.equal(domById("download-model-r").disabled, true);
domById("start-effect-planning").click();
domById("add-predictor").click();
let predictorRow = domById("predictor-rows").firstElementChild;
const predictorField = key => predictorRow.querySelector(`[data-predictor="${key}"]`);
await setStudyField(predictorField("name").id, "ability");
await setStudyField(predictorField("within").id, "item");
await setStudyField(predictorField("slopes").id, "item");
predictorField("interaction").checked = true;
predictorField("interaction").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 150));
assert.match(studyPayload().model_plan.formula, /outcome ~ condition_c \+ ability \+ condition_c:ability/);
assert.match(studyPayload().model_plan.formula, /1 \+ condition_c \+ ability \+ condition_c:ability \| item/);
assert.equal(studyPayload().model_plan.coefficient_count, 4);
assert.equal(studyPayload().inferential_route.gate.status, "blocked");
assert.equal(domById("download-model-r").disabled, false);
const numericModelR = domById("model-r-code").textContent;
await setStudyField("score-policy", "unknown_only");
const unknownModelR = domById("model-r-code").textContent;
domById("download-model-r").click();
assert.equal(downloadedName, "vocabulary-analysis-specification.R");
assert.equal(await downloadedBlob.text(), unknownModelR);
await setStudyField(predictorField("slopes").id, "participant");
assert.equal(domById("download-model-r").disabled, true);
assert.match(domById("model-errors").textContent, /requires variation/);
await setStudyField(predictorField("slopes").id, "unknown_facet");
assert.match(domById("model-errors").textContent, /unknown facet/);
await setStudyField(predictorField("slopes").id, "item");
await setStudyField(predictorField("name").id, "x);system('oops')");
assert.equal(domById("download-model-r").disabled, true);
await setStudyField(predictorField("name").id, "ability");
await setStudyField(predictorField("type").id, "factor");
predictorField("type").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(predictorField("levels").disabled, false);
await setStudyField(predictorField("levels").id, "3");
assert.equal(studyPayload().model_plan.coefficient_count, 6);
assert.match(studyPayload().model_plan.formula, /factor\(ability\)/);
const factorModelR = domById("model-r-code").textContent;
domById("add-predictor").click();
const secondName = domById("predictor-rows").lastElementChild.querySelector('[data-predictor="name"]');
await setStudyField(secondName.id, "ability");
assert.match(domById("model-errors").textContent, /unique R variable/);
assert.equal(domById("download-model-r").disabled, true);
domById("start-effect-planning").click();
assert.equal(domById("predictor-rows").children.length, 0);
assert.equal(studyPayload().inferential_route.calculation.status, "computed_sensitivity");
assert.equal(domById("score-policy").value, "all_targets");

if (process.argv.includes("--check-r")) {
  const directory = await mkdtemp(path.join(tmpdir(), "study-plan-r-"));
  try {
    await writeFile(path.join(directory, "numeric.R"), numericModelR);
    await writeFile(path.join(directory, "unknown.R"), unknownModelR);
    await writeFile(path.join(directory, "factor.R"), factorModelR);
    await writeFile(path.join(directory, "zero.R"), zeroEligibleR);
    await writeFile(path.join(directory, "check.R"), `
source("zero.R")
stopifnot(is.na(scores$proportion[2]))
source("numeric.R")
stopifnot(identical(scores$proportion, c(.5, .5, .625)))
set.seed(410)
d <- expand.grid(participant = factor(seq_len(40)), item = factor(seq_len(12)), time = 1:2)
d$condition_c <- ifelse((as.integer(d$participant) + as.integer(d$item)) %% 2 == 0, -.5, .5)
d$ability <- rnorm(40)[as.integer(d$participant)]
d$item_role <- ifelse(as.integer(d$item) <= 10, "target", "filler")
d$pretest_known <- as.integer(d$participant) %% 3 == 0 & as.integer(d$item) %% 3 == 0
d$outcome <- rbinom(nrow(d), 1, plogis(-.2 + .3 * d$condition_c + .2 * d$ability))
fit <- suppressWarnings(fit_study(d))
stopifnot(nobs(fit) == sum(d$item_role == "target"), nrow(lme4::getME(fit, "X")) == 800)
bad <- d; bad$condition_c <- 0
stopifnot(inherits(try(fit_study(bad), silent = TRUE), "try-error"))
source("unknown.R")
fit <- suppressWarnings(fit_study(d))
stopifnot(nobs(fit) == sum(d$item_role == "target" & !d$pretest_known))
source("factor.R")
d$ability <- factor((as.integer(d$participant) %% 3) + 1)
fit <- suppressWarnings(fit_study(d))
stopifnot(ncol(lme4::getME(fit, "X")) == 6)
cat("Score/R parity, filtering, numeric and factor GLMM specifications OK\\n")
`);
    const output = execFileSync("Rscript", ["--vanilla", "check.R"], { cwd: directory, timeout: 60000, encoding: "utf8", stdio: "pipe" });
    assert.match(output, /specifications OK/);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
console.log("Study planning: score definitions, zero eligibility, model slopes, gates and R exports OK");

// Runnable power simulation: separate gate, complete assumptions, no browser fits.
domById("start-effect-planning").click();
assert.equal(studyPayload().simulation_plan.status, "ready_for_offline_simulation");
assert.equal(domById("download-simulation-r").disabled, false);
await setStudyField("sim-n", "41");
assert.equal(domById("download-simulation-r").disabled, true);
await setStudyField("sim-n", "40");
await setStudyField("sim-k", "10");
await setStudyField("sim-reps", "3");
await setStudyField("sim-person_rho", ".2");
assert.match(domById("simulation-errors").textContent, /zero for diag/);
await setStudyField("sim-person_rho", "0");
const baseSimulationR = domById("simulation-r-code").textContent;
domById("download-simulation-r").click();
assert.equal(downloadedName, "vocabulary-power-simulation.R");
assert.equal(await downloadedBlob.text(), baseSimulationR);
await setStudyField("sim-known_rate", ".3");
assert.equal(domById("download-simulation-r").disabled, true);
await setStudyField("score-policy", "unknown_only");
assert.equal(domById("download-simulation-r").disabled, false);
const knownSimulationR = domById("simulation-r-code").textContent;
domById("add-predictor").click();
predictorRow = domById("predictor-rows").firstElementChild;
await setStudyField(predictorField("name").id, "ability");
await setStudyField(predictorField("within").id, "item");
await setStudyField(predictorField("slopes").id, "item");
predictorField("interaction").checked = true;
predictorField("interaction").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 150));
let simCard = domById("simulation-predictors").firstElementChild;
const simField = key => simCard.querySelector(`[data-sim-predictor="${key}"]`);
await setStudyField(simField("main").id, ".25");
await setStudyField(simField("interaction").id, ".3");
await setStudyField("sim-test-term", "condition_c:ability");
assert.equal(studyPayload().simulation_plan.config.beta["condition_c:ability"], .3);
assert.equal(studyPayload().simulation_plan.config.predictors[0].unit, "learner");
const numericSimulationR = domById("simulation-r-code").textContent;
// Inactive type-specific fields cannot leak NaN into an otherwise valid R export.
await setStudyField(predictorField("levels").id, "");
assert.equal(domById("download-simulation-r").disabled, false);
await setStudyField(predictorField("levels").id, "2");
const retainedPredictorId = predictorField("name").id;
domById("add-facet").click();
assert.equal(domById("predictor-rows").children.length, 1, "facet edits must preserve predictors");
assert.equal(predictorField("name").id, retainedPredictorId);
assert.equal(simField("main").value, ".25", "simulation assumptions survive structural edits");
assert.equal(domById("download-simulation-r").disabled, true);
domById("facet-rows").lastElementChild.querySelector("button").click();
assert.equal(domById("download-simulation-r").disabled, false);
await setStudyField(simField("mean").id, "");
assert.equal(domById("download-simulation-r").disabled, true);
await setStudyField(predictorField("type").id, "factor");
await setStudyField(predictorField("levels").id, "3");
assert.equal(domById("download-simulation-r").disabled, true, "need a coefficient for each factor contrast");
await setStudyField(simField("main").id, ".2, .4");
await setStudyField(simField("interaction").id, ".1, .3");
await setStudyField("sim-test-term", "condition_c:factor(ability)3");
// A full fitted covariance allows a valid nonzero common generating correlation.
const itemSlope = domById("facet-rows").children[1].querySelector('[data-field="slope"]');
itemSlope.value = "us";
itemSlope.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 150));
await setStudyField("sim-word_rho", "-.5");
assert.equal(domById("download-simulation-r").disabled, true);
await setStudyField("sim-word_rho", ".1");
assert.equal(domById("download-simulation-r").disabled, false);
const factorSimulationR = domById("simulation-r-code").textContent;
await setStudyField("sim-seed", "2147483647");
assert.equal(domById("download-simulation-r").disabled, true);
await setStudyField("sim-seed", "4101");
await setStudyField("sim-n", "5000");
await setStudyField("sim-k", "500");
assert.equal(domById("download-simulation-r").disabled, true, "reject impractically large fixed matrices");
domById("start-effect-planning").click();
assert.equal(studyPayload().simulation_plan.status, "ready_for_offline_simulation");
assert.equal(domById("sim-known_rate").value, "0");
assert.equal(domById("sim-n").value, "60");

if (process.argv.includes("--check-r")) {
  const directory = await mkdtemp(path.join(tmpdir(), "power-simulation-r-"));
  try {
    for (const [file, content] of [["base.R", baseSimulationR], ["known.R", knownSimulationR], ["numeric.R", numericSimulationR], ["factor.R", factorSimulationR]]) await writeFile(path.join(directory, file), content);
    await writeFile(path.join(directory, "check.R"), `
source("base.R")
a <- simulate_study(712)
stopifnot(nrow(a$data) == 800, all(table(a$data$participant, a$data$condition_c) == 10), all(table(a$data$item, a$data$condition_c) == 20))
config$fillers <- 100
b <- simulate_study(712)
stopifnot(identical(a$data, b$data), b$diagnostics$mean_feedback_score > a$diagnostics$mean_feedback_score)
config$fillers <- 10
x <- run_simulation(n_rep = 3, output_dir = "base-output")
stopifnot(nrow(x$replications) == 3, x$summary$usable_reps > 0, all(file.exists(file.path("base-output", c("assumptions.R", "replications.csv", "summary.csv", "session-info.txt", "README.txt")))))
y <- run_simulation(n_rep = 2, output_dir = "failed-output", fit_fun = function(data) stop("injected failure"))
stopifnot(y$summary$usable_reps == 0, is.na(y$summary$rejection_usable), y$summary$rejection_missing_lower == 0, y$summary$rejection_missing_upper == 1, all(y$replications$error == "injected failure"))
stopifnot(inherits(try(run_simulation(output_dir = "base-output"), silent = TRUE), "try-error"))
stopifnot(rate_summary(0, 10)["high"] > 0, rate_summary(10, 10)["low"] < 1)
# A hand-computed mixed success/failure ledger verifies denominators and singular sensitivity.
r <- x$replications[rep(1, 4), ]; r$usable <- c(TRUE,TRUE,FALSE,FALSE); r$p_value <- c(.01,.4,NA,NA)
r$singular <- c(TRUE,FALSE,NA,NA); r$covered_95 <- c(TRUE,FALSE,NA,NA); r$status <- c("converged","converged","failed","nonconverged")
s <- summarize_simulation(r)
stopifnot(s$rejection_usable == .5, s$rejection_nonsingular == 0, s$rejection_missing_lower == .25, s$rejection_missing_upper == .75, s$coverage_95_usable == .5)
source("known.R")
z <- simulate_study(712)
stopifnot(z$diagnostics$eligible_responses < 800, z$diagnostics$min_eligible_per_learner < z$diagnostics$max_eligible_per_learner)
f <- suppressMessages(suppressWarnings(fit_study(z$data)))
stopifnot(nobs(f) == z$diagnostics$eligible_responses)
config$known_rate <- 1
z <- run_simulation(n_rep = 2, output_dir = "empty-output")
stopifnot(z$summary$usable_reps == 0, all(z$replications$zero_eligible_learners == 40), all(is.na(z$replications$mean_unknown_score)))
source("numeric.R")
x <- run_simulation(n_rep = 2, output_dir = "numeric-output")
stopifnot(x$summary$test_term == "condition_c:ability", x$summary$true_coefficient == .3, x$summary$usable_reps > 0)
source("factor.R")
x <- run_simulation(n_rep = 2, output_dir = "factor-output")
stopifnot(x$summary$test_term == "condition_c:factor(ability)3", x$summary$true_coefficient == .3, nrow(x$replications) == 2, x$summary$failed_reps == 0)
cat("Simulation execution, generators, coefficient mapping, exclusions, failures and Monte Carlo summaries OK\\n")
`);
    const output = execFileSync("Rscript", ["--vanilla", "check.R"], { cwd: directory, timeout: 120000, encoding: "utf8", stdio: "pipe" });
    assert.match(output, /Monte Carlo summaries OK/);
    for (const folder of ["base-output", "failed-output", "empty-output", "numeric-output", "factor-output"]) {
      const parsed = dom.window.SimulationResults.parseSummary(await readFile(path.join(directory, folder, "summary.csv"), "utf8"));
      assert.equal(parsed.alpha, .05);
    }
    const cliOutput = execFileSync("Rscript", ["--vanilla", "base.R"], { cwd: directory, timeout: 60000, encoding: "utf8", stdio: "pipe" });
    assert.match(cliOutput, /Power for this coefficient/);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
console.log("Simulation planning and export contracts OK");

const metadata = JSON.parse(metadataText);
for (const asset of dom.window.document.querySelectorAll('script[src], link[rel="stylesheet"]')) {
  const url = new URL(asset.src || asset.href);
  assert.equal(url.searchParams.get("v"), metadata.sha256[url.pathname.slice(1)].slice(0, 12),
    "the page must request the CSS/script version matching this build");
}
for (const [name, expectedHash] of Object.entries(metadata.sha256)) {
  const bytes = await readFile(path.join(publicRoot, name));
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actualHash, expectedHash, `${name}: SHA-256 mismatch`);
}

const wrangler = JSON.parse(wranglerText);
assert.equal(wrangler.name, "reliability-design");
assert.equal(wrangler.compatibility_date, "2026-08-30");
assert.equal(wrangler.workers_dev, true, "review release must use an explicitly configured workers.dev route");
assert.equal(wrangler.preview_urls, false, "public versioned preview URLs must stay disabled");
assert.equal(wrangler.assets.directory, "./public");
assert.equal(wrangler.assets.not_found_handling, "single-page-application");
assert.equal(wrangler.main, undefined, "vertical slice must remain asset-only");

console.log(`Static app: ${fixtures.length} design fixtures, R goldens, 3 execution paths, four claim routes, 70 exact grid rows, CSP, config, and asset hashes OK`);
