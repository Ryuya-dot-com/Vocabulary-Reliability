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
