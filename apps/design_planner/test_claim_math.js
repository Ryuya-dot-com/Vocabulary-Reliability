#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHEMA_VERSION, alphaExpectation, effectProjection } = require("./claim_math.js");

const payload = JSON.parse(fs.readFileSync(
  path.join(__dirname, "data", "claim_math_fixtures.json"),
  "utf8"
));
assert.equal(payload.schema_version, SCHEMA_VERSION);

const close = (observed, expected, label) => {
  assert.ok(Math.abs(observed - expected) < 1e-12, `${label}: ${observed} != ${expected}`);
};

for (const fixture of payload.alpha_expectation) {
  const result = alphaExpectation(fixture.inputs);
  close(result.alpha, fixture.expected.alpha, `${fixture.id}: alpha`);
  assert.equal(result.floor_ceiling_flag, fixture.expected.floor_ceiling_flag, fixture.id);
  assert.equal(result.memory_sorting_flag, fixture.expected.memory_sorting_flag, fixture.id);
}
for (const fixture of payload.effect_projection) {
  const result = effectProjection(fixture.inputs);
  close(result.sampling_sd, fixture.expected.sampling_sd, `${fixture.id}: sampling_sd`);
  assert.equal(result.bottleneck, fixture.expected.bottleneck, fixture.id);
}

assert.throws(() => alphaExpectation({ k: 1.5, r_bar: 0.2, p_bar: 0.5 }), /integer/);
assert.throws(() => effectProjection({
  n_person: 0, k_per_condition: 15, person_slope_sd: 0.2, item_slope_sd: 0.2
}), /n_person/);
assert.throws(() => effectProjection({
  n_person: 120, k_per_condition: 15, person_slope_sd: 1e308, item_slope_sd: .2
}), /finite projection/);
assert.throws(() => effectProjection({
  n_person: 120, k_per_condition: 15, person_slope_sd: 1e-200, item_slope_sd: .2
}), /too small/);
assert.throws(() => effectProjection({
  n_person: 120, k_per_condition: Number.MAX_SAFE_INTEGER, person_slope_sd: .2, item_slope_sd: .2
}), /safe integers/);
close(effectProjection({ n_person: 120, k_per_condition: 15,
  person_slope_sd: .2, item_slope_sd: .2, memory_moderation: 1e308, memory_adjusted: true
}).sampling_sd, Math.sqrt(.2 ** 2 / 120 + .2 ** 2 / 30), "excluded memory component");

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({
    alpha_expectation: payload.alpha_expectation.map(fixture => ({
      id: fixture.id,
      ...alphaExpectation(fixture.inputs)
    })),
    effect_projection: payload.effect_projection.map(fixture => ({
      id: fixture.id,
      ...effectProjection(fixture.inputs)
    }))
  }));
} else {
  console.log(`JavaScript claim math: ${payload.alpha_expectation.length + payload.effect_projection.length} fixtures OK`);
}
