/* Local score/model specifications and offline R simulation export. */
(function (root) {
  "use strict";
  const idPattern = /^[A-Za-z][A-Za-z0-9_]*$/;
  const reserved = new Set("if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_complex_ NA_character_ outcome condition_c item_role pretest_known".split(" "));
  const safeId = name => idPattern.test(name) && !reserved.has(name);

  function scoreComparison(inputs) {
    const { target, correct, fillers, filler_correct: fillerCorrect, known, known_correct: knownCorrect, policy } = inputs;
    for (const value of [target, correct, fillers, fillerCorrect, known, knownCorrect]) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new Error("Use whole counts from 0 to 1,000,000.");
    }
    if (!target) throw new Error("Enter at least one target word.");
    if (correct > target || fillerCorrect > fillers || known > target || knownCorrect > known ||
        knownCorrect > correct || correct - knownCorrect > target - known) {
      throw new Error("Correct and pretest-known counts must fit their item sets. Check the overlap of known targets and posttest-correct targets.");
    }
    if (!["all_targets", "unknown_only"].includes(policy)) throw new Error("Choose a target-score policy.");
    const row = (label, numerator, denominator) => ({ label, numerator, denominator, proportion: denominator ? numerator / denominator : null });
    return [
      row("All target words", correct, target),
      row("Initially unknown targets", correct - knownCorrect, target - known),
      row("Whole test, including fillers", correct + fillerCorrect, target + fillers)
    ];
  }

  function modelPlan(design, audit, predictors) {
    const errors = [];
    const facets = new Map(design.facets.map(f => [f.id, f]));
    const condition = design.assignment.condition_levels === 2 ? "condition_c" : "factor(condition_c)";
    const fixed = [condition];
    const additions = new Map(design.facets.map(f => [f.id, []]));
    const names = new Set();
    let coefficientCount = design.assignment.condition_levels; // includes intercept
    for (const p of predictors) {
      if (!safeId(p.name) || facets.has(p.name) || names.has(p.name)) errors.push("Use unique R variable names (letters, digits, underscores), separate from facet IDs and reserved columns.");
      names.add(p.name);
      if (!["numeric", "factor"].includes(p.type) || (p.type === "factor" && (!Number.isSafeInteger(p.levels) || p.levels < 2 || p.levels > 100))) errors.push(`${p.name || "Predictor"}: a categorical predictor needs 2–100 levels.`);
      const term = p.type === "factor" ? `factor(${p.name})` : p.name;
      fixed.push(term);
      if (p.interaction) fixed.push(`${condition}:${term}`);
      coefficientCount += (p.type === "factor" ? p.levels - 1 : 1) * (p.interaction ? design.assignment.condition_levels : 1);
      for (const id of [...p.within, ...p.slopes]) {
        if (!facets.has(id)) errors.push(`${p.name}: unknown facet ${id}. Use the facet IDs declared below.`);
      }
      for (const id of p.slopes) {
        const facet = facets.get(id);
        if (!p.within.includes(id)) errors.push(`${p.name}: its slope within ${id} requires variation within that facet.`);
        if (facet && facet.model_role !== "random") errors.push(`${p.name}: ${id} must have the Random model role to receive a slope.`);
        if (facet && !["none", "diag", "us"].includes(facet.slope)) errors.push(`${p.name}: use none, diag or us for ${id}'s condition-slope structure before adding predictor slopes.`);
        if (p.interaction && facet && !facet.condition_varies_within) errors.push(`${p.name}: the condition interaction slope requires condition variation within ${id}.`);
        additions.get(id)?.push(term, ...(p.interaction ? [`${condition}:${term}`] : []));
      }
    }
    if (design.facets.some(f => !safeId(f.id))) errors.push("Model export requires simple R facet names (letters, digits, underscores; no reserved names).");
    const terms = design.facets.filter(f => f.model_role === "random").map(f => {
      const slopes = [...(f.slope === "none" ? [] : [condition]), ...additions.get(f.id)];
      return slopes.length ? `${f.slope === "none" ? "diag" : f.slope}(1 + ${slopes.join(" + ")} | ${f.id})` : `(1 | ${f.id})`;
    });
    if (!terms.length) errors.push("At least one random facet is required by this mixed-model export.");
    const valid = audit.can_compute && !errors.length;
    return {
      predictors, errors: [...new Set(errors)], coefficient_count: coefficientCount,
      status: valid ? (predictors.length ? "offline_model_required" : "base_model") : "blocked",
      formula: valid ? `outcome ~ ${fixed.join(" + ")} + ${terms.join(" + ")}` : null,
      scope: "Specification only. No full-rank, covariance, precision or power validation. Fixed facet roles denote fixed context; they do not add fixed predictor terms."
    };
  }

  function scoreR(inputs) {
    return [
      "# One-learner illustration; not observed data or an estimate of motivation/reliability.",
      ...Object.entries(inputs).map(([key, value]) => `${key} <- ${JSON.stringify(value)}`),
      "counts <- c(target, correct, fillers, filler_correct, known, known_correct)",
      "stopifnot(all(is.finite(counts)), all(counts == floor(counts)), all(counts >= 0 & counts <= 1000000))",
      "stopifnot(target > 0, correct <= target, filler_correct <= fillers, known <= target,",
      "          known_correct <= known, known_correct <= correct, correct - known_correct <= target - known)",
      'scores <- data.frame(score = c("All target words", "Initially unknown targets", "Whole test, including fillers"),',
      "  correct = c(correct, correct - known_correct, correct + filler_correct),",
      "  eligible = c(target, target - known, target + fillers))",
      "scores$proportion <- ifelse(scores$eligible > 0, scores$correct / scores$eligible, NA_real_)",
      "print(scores)",
      "# Zero eligible targets means undefined, not a score of zero.",
      "# Fillers do not increase the target-word count in the sensitivity projection.",
      "# A larger whole-test score is not evidence of improved learning or reliability.", ""
    ].join("\n");
  }

  function modelR(plan, design, scoreInputs) {
    if (!plan.formula) throw new Error("Resolve model and structural issues before exporting.");
    return [
      "# Vocabulary study: scoring example and analysis specification",
      "# Run with base R to print the illustration and define fit_study().",
      "# No files are read/written, packages installed, or model fitted automatically.",
      "# Not a power simulation. For planning, specify predictor distributions,",
      "# correlations, effect sizes, covariance matrices and the response process.",
      scoreR(scoreInputs),
      ...analysisLines(plan, design, scoreInputs)
    ].join("\n");
  }

  function analysisLines(plan, design, scoreInputs) {
    return [
      `model_formula <- as.formula(${JSON.stringify(plan.formula)})`,
      "print(model_formula)",
      "# fit_study(data) requires lme4 with support for the displayed covariance syntax.",
      "# Data: one binary response per row; outcome 0/1; item_role 'target'/'filler';",
      "# Nested facet IDs must be globally unique, not reused local labels.",
      "# grouping IDs matching the formula. Do not pool conditions or count fillers as targets.",
      design.assignment.condition_levels === 2
        ? "# condition_c must be coded -0.5 and +0.5 (slope = the two-condition logit contrast)."
        : `# condition_c must have exactly ${design.assignment.condition_levels} observed categories.`,
      "# For unknown-only scoring, pretest_known must be a complete logical column.",
      "# Predictor variation declarations are assumptions: verify them in the actual data.",
      "# Interactions selected here also enter any requested predictor random slopes.",
      "# Fixed-context facets are not covariate adjustments. Add substantive predictors explicitly.",
      "fit_study <- function(data) {",
      '  if (!requireNamespace("lme4", quietly = TRUE)) stop("Install lme4 separately before fitting.")',
      '  required <- unique(c(all.vars(model_formula), "item_role"))',
      '  if (!all(required %in% names(data))) stop("Missing required data columns.")',
      '  if (anyNA(data$item_role) || !all(data$item_role %in% c("target", "filler"))) stop("Declare target/filler roles for every row.")',
      '  analysis <- data[data$item_role == "target", , drop = FALSE]',
      ...(scoreInputs.policy === "unknown_only" ? [
        '  if (!"pretest_known" %in% names(analysis) || !is.logical(analysis$pretest_known) || anyNA(analysis$pretest_known)) stop("Supply complete logical pretest_known values.")',
        "  analysis <- analysis[!analysis$pretest_known, , drop = FALSE]"
      ] : []),
      '  if (!nrow(analysis) || anyNA(analysis[all.vars(model_formula)])) stop("No eligible rows or missing model values; specify a missing-data rule first.")',
      '  if (!all(analysis$outcome %in% c(0, 1))) stop("This analysis template requires binary outcomes.")',
      design.assignment.condition_levels === 2
        ? '  if (!is.numeric(analysis$condition_c) || !setequal(unique(analysis$condition_c), c(-0.5, 0.5))) stop("Use both condition codes -0.5 and +0.5.")'
        : `  if (length(unique(analysis$condition_c)) != ${design.assignment.condition_levels}) stop("Condition levels do not match the plan.")`,
      ...plan.predictors.map(p => p.type === "numeric"
        ? `  if (!is.numeric(analysis$${p.name}) || any(!is.finite(analysis$${p.name}))) stop("${p.name} must be finite numeric values.")`
        : `  if (length(unique(analysis$${p.name})) != ${p.levels}) stop("${p.name}: observed levels differ from the plan.")`),
      "  X <- model.matrix(lme4::nobars(model_formula), analysis)",
      '  if (qr(X)$rank < ncol(X)) stop("Fixed-effects design is rank deficient; revise the specification.")',
      "  fit <- lme4::glmer(model_formula, data = analysis, family = binomial(), nAGQ = 1)",
      '  if (lme4::isSingular(fit)) warning("Singular fit: inspect random-effects support.")',
      "  fit", "}",
      "# Inspect convergence messages and singularity; compare model and score definitions.",
      "# Exclusion changes the estimand to initially unknown items and may change denominators.",
      "# The example does not establish motivation benefits or causal identification.", ""
    ];
  }
  function simulationPlan(model, design, scoreInputs, settings, predictorSettings) {
    const errors = [];
    const pair = list => list.length === 2 && [...list].sort().join(",") === "item,participant";
    if (!model.formula) errors.push("Resolve the model and structural issues first.");
    if (!pair(design.facets.map(f => f.id)) || !pair(design.units.assignment) ||
        design.assignment.mode !== "crossed_counterbalance" || design.assignment.condition_levels !== 2 ||
        design.facets.some(f => f.parent || f.model_role !== "random" || !f.condition_varies_within || !["none", "diag", "us"].includes(f.slope) || !["iid", "diag", "us"].includes(f.dependence))) {
      errors.push("This simulator requires exactly crossed participant and item facets, two counterbalanced conditions and none/diag/us slope structures. Other designs can still use the analysis specification.");
    }
    const integer = (key, min, max) => {
      if (!Number.isSafeInteger(settings[key]) || settings[key] < min || settings[key] > max) errors.push(`${key}: enter a whole number from ${min} to ${max}.`);
    };
    integer("n", 4, 5000); integer("k", 2, 500); integer("reps", 2, 10000); integer("seed", 1, 2147473647); integer("fillers", 0, 1000);
    if (settings.n % 2) errors.push("Use an even learner count for equal counterbalancing lists.");
    if (settings.n * 2 * settings.k * model.coefficient_count > 2000000) errors.push("The planned fixed-effect matrix exceeds two million cells. Reduce counts/terms or prepare a custom simulation.");
    for (const key of ["intercept", "effect"]) if (!Number.isFinite(settings[key])) errors.push(`${key}: enter a finite logit coefficient.`);
    for (const key of ["alpha", "known_rate", "known_accuracy", "filler_accuracy"]) {
      if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1 || (key === "alpha" && [0, 1].includes(settings[key]))) errors.push(`${key}: enter a valid probability (alpha strictly between 0 and 1).`);
    }
    if (scoreInputs.policy === "all_targets" && settings.known_rate !== 0) errors.push("For known target mixtures, select initially unknown targets in the score definition. This simulator otherwise requires known-target rate = 0; it does not fit an omitted knownness mixture.");
    const beta = { "(Intercept)": settings.intercept, condition_c: settings.effect };
    const predictors = model.predictors.map((p, i) => {
      const values = predictorSettings[i];
      const unit = p.within.length === 1 && p.within[0] === "item" ? "learner"
        : p.within.length === 1 && p.within[0] === "participant" ? "word"
        : pair(p.within) ? "response" : null;
      if (!unit) errors.push(`${p.name}: declare variation within item (learner-level), participant (word-level), or both (response-level) for this generator.`);
      const count = p.type === "factor" ? p.levels - 1 : 1;
      for (const key of ["main", ...(p.interaction ? ["interaction"] : [])]) {
        if (!values || values[key].length !== count || values[key].some(v => !Number.isFinite(v))) errors.push(`${p.name}: supply ${count} finite ${key} coefficient(s).`);
      }
      if (p.type === "numeric" && (!values || !Number.isFinite(values.mean) || !Number.isFinite(values.sd) || values.sd <= 0)) errors.push(`${p.name}: numeric predictors need a finite normal mean and positive SD.`);
      const names = p.type === "numeric" ? [p.name] : Array.from({ length: Math.min(100, Math.max(0, count)) }, (_, i) => `factor(${p.name})${i + 2}`);
      names.forEach((name, index) => {
        beta[name] = values?.main[index];
        if (p.interaction) beta[`condition_c:${name}`] = values?.interaction[index];
      });
      return { name: p.name, type: p.type, levels: p.type === "factor" ? p.levels : null, mean: p.type === "numeric" ? values?.mean : null, sd: p.type === "numeric" ? values?.sd : null, unit };
    });
    const random = {};
    for (const facet of design.facets.filter(f => ["participant", "item"].includes(f.id))) {
      const prefix = facet.id === "participant" ? "person" : "word";
      for (const suffix of ["intercept_sd", "condition_sd", "additional_sd"]) {
        const value = settings[`${prefix}_${suffix}`];
        if (!Number.isFinite(value) || value < 0) errors.push(`${prefix}_${suffix}: enter a finite non-negative SD.`);
      }
      const terms = facet.slope === "none" ? [] : ["condition_c"];
      let count = 1 + terms.length;
      for (const p of model.predictors.filter(p => p.slopes.includes(facet.id))) {
        const term = p.type === "factor" ? `factor(${p.name})` : p.name;
        terms.push(term, ...(p.interaction ? [`condition_c:${term}`] : []));
        count += (p.type === "factor" ? p.levels - 1 : 1) * (p.interaction ? 2 : 1);
      }
      const rho = settings[`${prefix}_rho`];
      if (!Number.isFinite(rho) || (count > 1 && (rho <= -1 / (count - 1) || rho >= 1)) || (facet.slope !== "us" && rho !== 0)) errors.push(`${prefix}_rho: use zero for diag/none; for us the common correlation must be > ${count > 1 ? (-1 / (count - 1)).toFixed(3) : "-1"} and < 1.`);
      random[facet.id] = { dimension: count, covariance: facet.slope === "us" ? "us" : "diag", formula: `~ 1${terms.length ? " + " + terms.join(" + ") : ""}`, intercept_sd: settings[`${prefix}_intercept_sd`], condition_sd: settings[`${prefix}_condition_sd`], additional_sd: settings[`${prefix}_additional_sd`], rho };
    }
    if (!Object.hasOwn(beta, settings.test_term) || settings.test_term === "(Intercept)") errors.push("Select a fixed coefficient to test.");
    return { status: errors.length ? "blocked" : "ready_for_offline_simulation", errors: [...new Set(errors)],
      config: { ...Object.fromEntries(["n", "k", "reps", "seed", "alpha", "known_rate", "known_accuracy", "fillers", "filler_accuracy", "test_term"].map(key => [key, settings[key]])), policy: scoreInputs.policy, beta, predictors, random },
      test_terms: Object.keys(beta).filter(name => name !== "(Intercept)") };
  }

  function rValue(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Non-finite R input."); return String(value); }
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) return `list(${value.map(rValue).join(", ")})`;
    return `list(${Object.entries(value).map(([key, v]) => `${JSON.stringify(key)} = ${rValue(v)}`).join(",\n  ")})`;
  }

  function simulationR(simulation, model, design, scoreInputs) {
    if (simulation.status !== "ready_for_offline_simulation") throw new Error("Resolve simulation assumptions before exporting.");
    return [
      "# Vocabulary design planner: assumption-based Monte Carlo simulation",
      "# Rscript --vanilla vocabulary-power-simulation.R runs the simulation.",
      "# In RStudio, source this file, then call run_simulation(). Requires lme4 >= 2.0.6.",
      "# Writes a NEW output directory: assumptions, per-replication results, summary,",
      "# session information and interpretation notes. No package installation or network use.",
      "# Independent covariates; one binary target response per learner-word pair.",
      "# Numeric coefficients are per entered predictor unit; factors use level 1 as reference.",
      "# A condition main effect with interactions is conditional at numeric 0/reference levels.",
      "# All entries are assumptions, not fitted estimates or a sample-size recommendation.",
      "# Methods: https://doi.org/10.1002/sim.8086; https://lme4.github.io/lme4/reference/pvalues.html",
      `config <- ${rValue(simulation.config)}`, "",
      ...analysisLines(model, design, scoreInputs), root.SimulationEngine,
      "if (sys.nframe() == 0L) run_simulation()", ""
    ].join("\n");
  }

  root.StudyPlan = Object.freeze({ scoreComparison, modelPlan, scoreR, modelR, simulationPlan, simulationR });
})(window);
