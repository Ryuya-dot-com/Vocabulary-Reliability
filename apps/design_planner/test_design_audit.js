#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHEMA_VERSION, STATES, auditDesignGraph } = require("./design_audit.js");

const fixturePath = path.join(__dirname, "data", "design_audit_fixtures.json");
const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.equal(payload.schema_version, SCHEMA_VERSION);

const observedStates = new Set();
const paritySummary = [];
for (const fixture of payload.fixtures) {
  const result = auditDesignGraph(fixture.design, fixture.validated_ids);
  observedStates.add(result.state);
  assert.equal(result.state, fixture.expected_state, fixture.id);
  const codes = new Set(result.issues.map(issue => issue.code));
  for (const code of fixture.expected_codes) {
    assert.ok(codes.has(code), `${fixture.id}: missing reason code ${code}`);
  }
  assert.equal(
    result.can_compute,
    ["Estimable but fragile", "Within validated envelope"].includes(result.state),
    `${fixture.id}: can_compute`
  );
  paritySummary.push({
    id: fixture.id,
    state: result.state,
    can_compute: result.can_compute,
    issues: result.issues.map(({ code, severity, facet }) => ({ code, severity, facet })),
    random_effect_terms: result.random_effect_terms,
    formula_suggestion: result.formula_suggestion,
    claim_boundary: result.claim_boundary
  });
}

assert.deepEqual(new Set(STATES), observedStates, "fixtures exercise all four states");

const validated = payload.fixtures.find(f => f.id === "hierarchical_crossed_validated");
const validatedResult = auditDesignGraph(validated.design, validated.validated_ids);
for (const facet of ["prefecture", "school", "class", "participant", "item"]) {
  assert.ok(
    validatedResult.random_effect_terms.includes(`diag(1 + condition_c | ${facet})`),
    `validated hierarchy: missing ${facet} slope`
  );
}

const omitted = payload.fixtures.find(f => f.id === "omitted_item_slope");
const omittedResult = auditDesignGraph(omitted.design, omitted.validated_ids);
assert.ok(omittedResult.claim_boundary.does_not_generalize_over.includes("item"));
assert.ok(!omittedResult.claim_boundary.generalizes_over.includes("item"));

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(paritySummary));
} else {
  console.log(`JavaScript design audit: ${payload.fixtures.length} fixtures OK`);
}
