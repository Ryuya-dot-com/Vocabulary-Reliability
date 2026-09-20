/* Local score arithmetic and model specification; no simulation or model fitting. */
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
    ].join("\n");
  }
  root.StudyPlan = Object.freeze({ scoreComparison, modelPlan, scoreR, modelR });
})(window);
