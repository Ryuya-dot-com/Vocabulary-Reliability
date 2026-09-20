/* Dependency-free closed-form calculations shared by the static frontend.
 * These are sensitivity projections, not fitted estimates, power results, or
 * validation certificates. Keep numerical behavior in parity with the pure R
 * functions in planner_functions.R.
 */
(function attachClaimMath(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClaimMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function claimMathFactory() {
  "use strict";

  const SCHEMA_VERSION = "1.0.0";

  function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite number`);
    }
    return value;
  }

  function expectedAlpha(k, rBar) {
    finiteNumber(k, "k");
    finiteNumber(rBar, "r_bar");
    if (!Number.isSafeInteger(k) || k < 1) throw new RangeError("k must be an integer >= 1 within the safe numeric range");
    if (rBar < 0 || rBar >= 1) throw new RangeError("r_bar must be in [0, 1)");
    return k * rBar / (1 + (k - 1) * rBar);
  }

  function alphaExpectation({ k, r_bar: rBar, p_bar: pBar, high_load: highLoad = false }) {
    finiteNumber(pBar, "p_bar");
    if (pBar < 0 || pBar > 1) throw new RangeError("p_bar must be in [0, 1]");
    if (typeof highLoad !== "boolean") throw new TypeError("high_load must be boolean");
    const alpha = expectedAlpha(k, rBar);
    return {
      alpha,
      floor_ceiling_flag: pBar < 0.15 || pBar > 0.85,
      memory_sorting_flag: highLoad && alpha > 0.9
    };
  }

  function effectProjection({
    n_person: nPerson,
    k_per_condition: kPerCondition,
    person_slope_sd: personSlopeSd,
    item_slope_sd: itemSlopeSd,
    memory_moderation: memoryModeration = 0,
    memory_adjusted: memoryAdjusted = false
  }) {
    for (const [value, label] of [
      [nPerson, "n_person"],
      [kPerCondition, "k_per_condition"],
      [personSlopeSd, "person_slope_sd"],
      [itemSlopeSd, "item_slope_sd"],
      [memoryModeration, "memory_moderation"]
    ]) finiteNumber(value, label);
    if (!Number.isSafeInteger(nPerson) || nPerson < 1) {
      throw new RangeError("n_person must be an integer >= 1");
    }
    if (!Number.isSafeInteger(kPerCondition) || kPerCondition < 1 || !Number.isSafeInteger(2 * kPerCondition)) {
      throw new RangeError("k_per_condition and total words must be safe integers >= 1");
    }
    if (personSlopeSd < 0 || itemSlopeSd < 0 || memoryModeration < 0) {
      throw new RangeError("slope SDs and memory_moderation must be >= 0");
    }
    if (typeof memoryAdjusted !== "boolean") {
      throw new TypeError("memory_adjusted must be boolean");
    }

    const totalWords = 2 * kPerCondition;
    const unmodeledPersonSd = Math.sqrt(personSlopeSd ** 2 + memoryModeration ** 2);
    const projectionPersonSd = memoryAdjusted ? personSlopeSd : unmodeledPersonSd;
    const personTerm = projectionPersonSd ** 2 / nPerson;
    const itemTerm = itemSlopeSd ** 2 / totalWords;
    if (!Number.isFinite(personTerm + itemTerm)) {
      throw new RangeError("The variation values are too large to calculate a finite projection.");
    }
    // Subnormal variance terms lose precision and may turn a positive SD into zero.
    if (((personSlopeSd > 0 || (!memoryAdjusted && memoryModeration > 0)) && personTerm < 2 ** -1022) ||
        (itemSlopeSd > 0 && itemTerm < 2 ** -1022)) {
      throw new RangeError("The variation values are too small for reliable numerical precision at these counts. Zero should only be used when no variation is assumed.");
    }
    const bottleneck = personTerm > 1.5 * itemTerm
      ? "participants"
      : itemTerm > 1.5 * personTerm
        ? "items"
        : "both";

    return {
      sampling_sd: Math.sqrt(personTerm + itemTerm),
      person_component: personTerm,
      item_component: itemTerm,
      bottleneck,
      total_words: totalWords
    };
  }

  return Object.freeze({ SCHEMA_VERSION, expectedAlpha, alphaExpectation, effectProjection });
});
