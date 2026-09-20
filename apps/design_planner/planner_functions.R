#!/usr/bin/env Rscript
# planner_functions.R
#
# Pure functions for the Design Planner Shiny app (Supplementary Material
# companion tool). No side effects other than reading the small bundled CSV
# snapshots in apps/design_planner/data/. No shiny/ggplot2 dependency here so
# that every function can be unit-tested with plain Rscript
# (see test_planner_functions.R).
#
# Provenance of every published-value comparison lives in
# test_planner_functions.R, not in this file's comments alone.

## -------------------------------------------------------------------------
## 0. Path resolution (works both when source()'d from app.R and when this
##    file is Rscript'd directly, e.g. by the test harness)
## -------------------------------------------------------------------------

#' Locate this file's own directory, robust to how it was loaded.
#'
#' IMPORTANT: this must be called at source-time (top-level, synchronous),
#' not lazily from inside a later function call -- see the note above
#' .PD_THIS_DIR_CACHE below for why.
#' @keywords internal
.pd_this_dir <- function() {
  # Case 1 (checked first): source()'d (e.g. from app.R, or nested inside
  # another script that source()s app.R, as in the test harness). Walk the
  # call stack from innermost outward looking for a frame with an "ofile"
  # (source() sets this as a local variable in the frame it creates). The
  # INNERMOST such frame, at the moment this file's own top-level code is
  # running, is necessarily the source() call that loaded this file itself
  # -- nothing more deeply nested has started yet. commandArgs() cannot be
  # used for this case: it always reflects the top-level Rscript target for
  # the whole process, which is wrong whenever this file was source()'d from
  # a *different* top-level script (confirmed empirically: it silently
  # returned the caller's directory instead of this file's own, breaking
  # bundled-CSV lookups inside Shiny's asynchronous reactive callbacks).
  for (fr in rev(sys.frames())) {
    ofile <- fr$ofile
    if (!is.null(ofile) && file.exists(ofile)) {
      return(dirname(normalizePath(ofile)))
    }
  }
  # Case 2: no source() frame found, so this file must itself be the
  # top-level Rscript target ("Rscript planner_functions.R").
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 1) {
    script_path <- sub("^--file=", "", file_arg[1])
    if (file.exists(script_path)) {
      return(dirname(normalizePath(script_path)))
    }
  }
  # Case 3: last resort, assume the working directory is the app directory.
  getwd()
}

## IMPORTANT: resolve and cache this file's directory ONCE, here, at
## source-time (top-level, synchronous execution). Do NOT recompute this
## lazily inside .pd_data_dir()'s default arguments: those defaults are only
## evaluated the first time a loader function is actually CALLED, which for
## a Shiny app happens from deep inside asynchronous reactive callbacks whose
## call stack no longer contains the frame that originally source()'d this
## file -- sys.frames()-based detection silently returns the wrong directory
## in that context (confirmed with shiny::testServer during development).
## Caching the resolved path at source time sidesteps the problem entirely.
.PD_THIS_DIR_CACHE <- .pd_this_dir()

#' Directory holding the bundled reference-grid CSVs.
#' @keywords internal
.pd_data_dir <- function() {
  file.path(.PD_THIS_DIR_CACHE, "data")
}

#' Round-half-up (away from zero), tolerant of binary floating-point
#' representation error (e.g. 15*.10/(1+14*.10) is stored as
#' 0.62499999999999989 rather than the mathematically exact 0.625, which
#' would otherwise round down under R's default round-half-to-even). Used
#' for display formatting so that values matching manuscript Table 2's exact
#' fractions round the same way the manuscript reports them (verified in
#' test_planner_functions.R).
#' @keywords internal
pd_round_half_up <- function(x, digits = 0) {
  scale <- 10^digits
  sign(x) * floor(abs(x) * scale + 0.5 + 1e-9) / scale
}

## -------------------------------------------------------------------------
## Tab 1: Alpha expectations (interactive Table 2)
## Corresponds to Figure 1's person-level-score branch.
## -------------------------------------------------------------------------

#' Expected Cronbach's alpha / KR-20 from the classical Spearman-Brown-type
#' relation between item count and average inter-item correlation.
#'
#' alpha = k * rbar / (1 + (k - 1) * rbar)
#'
#' This is the textbook prophecy formula underlying manuscript Table 2's
#' theoretical rows (verified in test_planner_functions.R against the
#' published k=15/k=30 rows).
#'
#' @param k Integer/numeric, number of items (must be >= 1).
#' @param r_bar Numeric in [0, 1), average inter-item correlation.
#' @return Numeric expected alpha.
expected_alpha <- function(k, r_bar) {
  stopifnot(is.numeric(k), is.numeric(r_bar))
  if (any(k < 1)) stop("k must be >= 1")
  if (any(r_bar < 0 | r_bar >= 1)) stop("r_bar must be in [0, 1)")
  k * r_bar / (1 + (k - 1) * r_bar)
}

#' Diagnostic flags for an alpha-expectation query, mirroring the reading
#' notes attached to manuscript Table 2.
#'
#' @param k Number of items.
#' @param r_bar Average inter-item correlation.
#' @param p_bar Expected mean proportion correct (0-1).
#' @param high_load Logical; TRUE if the design is a high-cognitive-load
#'   design (e.g., many words presented under short/massed exposure), the
#'   condition under which Table 2 observed alpha = .94 coinciding with an
#'   r = .90 correlation between total score and memory aptitude.
#' @return A list with expected_alpha, floor_ceiling_flag (logical + message),
#'   and memory_sorting_flag (logical + message).
alpha_expectation_flags <- function(k, r_bar, p_bar, high_load = FALSE) {
  stopifnot(is.numeric(p_bar), length(p_bar) == 1, p_bar >= 0, p_bar <= 1)
  a <- expected_alpha(k, r_bar)

  floor_ceiling <- (p_bar > 0.85) || (p_bar < 0.15)
  floor_ceiling_msg <- if (floor_ceiling) {
    paste0(
      "Floor/ceiling risk: mean accuracy p̄ = ", sprintf("%.2f", p_bar),
      " is outside .15-.85. Restricted score variance tends to compress ",
      "realized item correlations toward zero, so the observed coefficient ",
      "is often well below this formula's r̄-based prediction ",
      "(Table 2: a 15-item near-ceiling score simulated a median alpha of ",
      ".31; a 30-item recognition test at high accuracy simulated .29)."
    )
  } else {
    "No floor/ceiling flag: mean accuracy is within the .15-.85 band."
  }

  memory_sorting <- isTRUE(high_load) && a > 0.90
  memory_sorting_msg <- if (memory_sorting) {
    paste0(
      "High-load memory-sorting caution: expected alpha = ", sprintf("%.2f", a),
      " (> .90) under a high-load design. In Table 2's simulated high-load ",
      "scenario, an alpha this high co-occurred with r = .90 between total ",
      "score and memory aptitude -- check whether the score is certifying ",
      "learning or sorting learners by memory capacity."
    )
  } else if (isTRUE(high_load)) {
    "High-load design flagged, but expected alpha is not above .90; no memory-sorting caution triggered."
  } else {
    "No memory-sorting flag: design not marked as high-load."
  }

  list(
    expected_alpha = a,
    floor_ceiling_flag = floor_ceiling,
    floor_ceiling_message = floor_ceiling_msg,
    memory_sorting_flag = memory_sorting,
    memory_sorting_message = memory_sorting_msg
  )
}

#' Sweep of expected alpha across a range of item counts, for one or more
#' average inter-item correlations -- the interactive analogue of manuscript
#' Table 2's k=15/k=30 rows, extended to a continuous k grid. A pure
#' application of expected_alpha() over a (r_bar, k) grid; no new formula, no
#' simulation.
#'
#' @param r_bar_values Numeric vector of average inter-item correlations to
#'   sweep (default matches the three r̄ anchors used throughout Table 2 and
#'   the Tab 1 reference table: .10, .15, .22).
#' @param k_max Maximum number of items to sweep to (inclusive).
#' @param k_min Minimum number of items to sweep from (inclusive); default 2,
#'   matching expected_alpha()'s and Tab 1's numericInput floor.
#' @return A data.frame with one row per (r_bar, k) combination and columns
#'   r_bar, k, alpha.
alpha_curve <- function(r_bar_values = c(.10, .15, .22), k_max = 60, k_min = 2) {
  stopifnot(is.numeric(r_bar_values), is.numeric(k_max), is.numeric(k_min))
  if (k_min < 1) stop("k_min must be >= 1")
  if (k_max < k_min) stop("k_max must be >= k_min")
  k_seq <- seq.int(k_min, k_max)
  grid <- expand.grid(r_bar = r_bar_values, k = k_seq)
  grid$alpha <- expected_alpha(grid$k, grid$r_bar)
  grid[order(grid$r_bar, grid$k), ]
}

## -------------------------------------------------------------------------
## Tab 2: Effect generalizability (interactive Supplementary Figure S2)
## Corresponds to Figure 1's generalization-beyond-sampled-words-and-learners branch.
##
## Formula extracted verbatim from
## scripts/run_effect_generalizability_simulations.R, lines ~142-146:
##   total_words <- 2 * k_per_condition
##   person_slope_sd_unmodeled <- sqrt(person_slope_sd^2 + memory_moderation^2)
##   effect_sampling_sd_unmodeled <- sqrt(person_slope_sd_unmodeled^2 / n_person
##                                          + item_slope_sd^2 / total_words)
##   effect_sampling_sd_memory_adjusted <- sqrt(person_slope_sd^2 / n_person
##                                                + item_slope_sd^2 / total_words)
## and the bottleneck classification, lines ~149-153:
##   main_bottleneck <- case_when(
##     (person_slope_sd_unmodeled^2 / n_person) > 1.5 * (item_slope_sd^2 / total_words) ~ "participants",
##     (item_slope_sd^2 / total_words) > 1.5 * (person_slope_sd_unmodeled^2 / n_person) ~ "items",
##     TRUE ~ "both"
##   )
## -------------------------------------------------------------------------

#' Analytic D-study-style projection of the sampling SD of the latent
#' condition effect. Same formula as effect_sampling_sd_unmodeled /
#' effect_sampling_sd_memory_adjusted in
#' scripts/run_effect_generalizability_simulations.R -- not re-derived.
#'
#' @param n_person Number of participants.
#' @param k_per_condition Items per condition (total_words = 2 * k_per_condition,
#'   matching the counterbalanced two-condition design simulated in sim_07).
#' @param person_slope_sd SD of the person-level random slope for condition.
#' @param item_slope_sd SD of the item-level random slope for condition.
#' @param memory_moderation Coefficient linking a person-level memory/aptitude
#'   covariate to the condition slope (0 if none).
#' @param memory_adjusted Logical. FALSE ("unmodeled") folds the memory
#'   moderation variance into the person-slope noise term, matching a model
#'   that does NOT include a condition-by-memory interaction. TRUE
#'   ("memory_adjusted") assumes memory is modeled as a moderator, so its
#'   contribution is not counted as unexplained person-level noise.
#' @return Numeric projected sampling SD of the latent condition effect.
effect_sampling_sd <- function(n_person, k_per_condition, person_slope_sd,
                                item_slope_sd, memory_moderation = 0,
                                memory_adjusted = FALSE) {
  stopifnot(all(is.finite(c(n_person, k_per_condition, person_slope_sd,
                           item_slope_sd, memory_moderation))),
            n_person > 0, k_per_condition > 0,
            person_slope_sd >= 0, item_slope_sd >= 0)
  total_words <- 2 * k_per_condition
  person_component_sd <- if (isTRUE(memory_adjusted)) {
    person_slope_sd
  } else {
    sqrt(person_slope_sd^2 + memory_moderation^2)
  }
  person_term <- person_component_sd^2 / n_person
  item_term <- item_slope_sd^2 / total_words
  if (any(!is.finite(person_term + item_term))) {
    stop("The variation values are too large to calculate a finite projection.")
  }
  if (any(((person_slope_sd != 0 | (!isTRUE(memory_adjusted) & memory_moderation != 0)) &
           person_term < .Machine$double.xmin) |
          (item_slope_sd != 0 & item_term < .Machine$double.xmin))) {
    stop("The variation values are too small for reliable numerical precision at these counts. Zero should only be used when no variation is assumed.")
  }
  sqrt(person_term + item_term)
}

#' Bottleneck classification, replicating main_bottleneck's case_when logic
#' for the default unmodeled case (same 1.5x asymmetry threshold). When memory
#' is accounted for, compare the same residual components as the SD projection.
#'
#' @return One of "participants", "items", "both".
effect_bottleneck <- function(n_person, k_per_condition, person_slope_sd,
                               item_slope_sd, memory_moderation = 0,
                               memory_adjusted = FALSE) {
  # Apply the same numerical-range checks as the SD projection.
  effect_sampling_sd(n_person, k_per_condition, person_slope_sd,
                     item_slope_sd, memory_moderation, memory_adjusted)
  total_words <- 2 * k_per_condition
  person_term <- (person_slope_sd^2 + if (isTRUE(memory_adjusted)) 0 else memory_moderation^2) / n_person
  item_term <- item_slope_sd^2 / total_words
  if (person_term > 1.5 * item_term) {
    "participants"
  } else if (item_term > 1.5 * person_term) {
    "items"
  } else {
    "both"
  }
}

#' Curve of the projected sampling SD across a grid of items-per-condition,
#' for one N -- the interactive analogue of Supplementary Figure S2's panels.
#'
#' @param n_person Number of participants.
#' @param k_seq Vector of items-per-condition values (default matches the
#'   values actually used in sim_07's projection grid: 5, 10, 15, 30, 60, 100).
#' @return A data.frame with one row per k_seq value.
effect_generalizability_curve <- function(n_person, person_slope_sd, item_slope_sd,
                                           memory_moderation = 0,
                                           k_seq = c(5, 10, 15, 30, 60, 100)) {
  sd_unmodeled <- vapply(k_seq, function(k) {
    effect_sampling_sd(n_person, k, person_slope_sd, item_slope_sd,
                        memory_moderation, memory_adjusted = FALSE)
  }, numeric(1))
  sd_memory_adjusted <- vapply(k_seq, function(k) {
    effect_sampling_sd(n_person, k, person_slope_sd, item_slope_sd,
                        memory_moderation, memory_adjusted = TRUE)
  }, numeric(1))
  bottleneck <- vapply(k_seq, function(k) {
    effect_bottleneck(n_person, k, person_slope_sd, item_slope_sd, memory_moderation)
  }, character(1))
  data.frame(
    n_person = n_person,
    k_per_condition = k_seq,
    effect_sampling_sd_unmodeled = sd_unmodeled,
    effect_sampling_sd_memory_adjusted = sd_memory_adjusted,
    main_bottleneck = bottleneck,
    stringsAsFactors = FALSE
  )
}

#' Load the five named sim_07 scenarios (bundled snapshot of the
#' scenario_specs tribble in run_effect_generalizability_simulations.R) as
#' ready-made presets for Tab 2's inputs.
load_effect_scenario_specs <- function(data_dir = .pd_data_dir()) {
  path <- file.path(data_dir, "effect_scenario_specs.csv")
  read.csv(path, stringsAsFactors = FALSE)
}

## -------------------------------------------------------------------------
## Tab 3: GLMM detection & risks
## Corresponds to Figure 1's condition-effect branch, with design-diagnostic
## notes for singular/boundary fit risk.
##
## Design decision (see test_planner_functions.R calibration section and
## design_decisions in the build log): a first-order Wald power formula
## (beta/SE -> Phi) is well-calibrated GIVEN a real fitted beta and SE (max
## abs error 3.1pp across the 30 sim_19 published points). But there is no
## validated closed-form in this codebase for generating SE from arbitrary
## user-specified design parameters (N, k, effect size, heterogeneity)
## without fitting a model -- a naive textbook approximation that ignores
## participant/item clustering was tested and produced >15pp error on 18/24
## sim_19 points (up to 92pp for partial-credit scoring). Per the task's
## explicit accuracy-over-features mandate, Tab 3 therefore does NOT expose
## a free-form "type any N/k/effect -> power" Wald calculator. Instead it
## looks up / interpolates the real published sim_19 and sim_07 grids, using
## the Wald Phi-transform only to interpolate between two REAL bracketing
## grid points (never to extrapolate from first principles).
## -------------------------------------------------------------------------

#' First-order two-sided Wald power approximation from a fixed-effect
#' estimate and its standard error.
#'
#' power ~= Phi(|beta|/SE - 1.96) + Phi(-|beta|/SE - 1.96)
#'
#' Validated (not derived from scratch) against 48 published sim_19 points:
#' see test_planner_functions.R. Used internally only to interpolate between
#' two real grid anchors, never to predict from user-typed design parameters
#' with no matching real beta/SE.
#'
#' @param beta Fixed-effect estimate (log-odds or comparable scale).
#' @param se Standard error of that estimate.
#' @return Predicted proportion of replications with p < .05, in [0, 1].
wald_power <- function(beta, se) {
  z <- abs(beta) / se
  stats_pnorm <- stats::pnorm
  stats_pnorm(z - 1.96) + stats_pnorm(-z - 1.96)
}

#' Load the bundled sim_19 (small ecological classroom) detection grid.
load_sim19_grid <- function(data_dir = .pd_data_dir()) {
  path <- file.path(data_dir, "sim19_grid.csv")
  read.csv(path, stringsAsFactors = FALSE)
}

#' Load the bundled sim_07 (item/person-sensitive, larger-N) detection grid.
load_sim07_grid <- function(data_dir = .pd_data_dir()) {
  path <- file.path(data_dir, "sim07_grid.csv")
  read.csv(path, stringsAsFactors = FALSE)
}

#' Power-law interpolation/extrapolation through two known points.
#' y = y1 * (x / x1) ^ b,  b = log(y2/y1) / log(x2/x1)
#' @keywords internal
.pd_loglog_interp <- function(x, x1, y1, x2, y2) {
  b <- log(y2 / y1) / log(x2 / x1)
  y1 * (x / x1)^b
}

#' Predict GLMM detection power for the small ecological classroom family
#' (sim_19), for an arbitrary N between the two published anchors (24, 60).
#' Never extrapolates beyond the published range; SE is interpolated with a
#' 2-point power-law fit through the two real anchors, beta linearly. The
#' singular-fit rate is NEVER interpolated -- only the two real bracketing
#' values are reported, as an observed range.
#'
#' @param scenario One of the four sim_19 scenario codes
#'   (see unique(load_sim19_grid()$scenario)).
#' @param scoring_label One of "Strict full recall", "Lenient any knowledge",
#'   "Partial credit".
#' @param n_target Target N (participants).
#' @return A list describing the prediction, its mode ("exact_grid_point",
#'   "interpolated", or "clamped_extrapolation"), and the mandatory caveat.
predict_sim19_detection <- function(scenario, scoring_label, n_target,
                                     grid = load_sim19_grid()) {
  rows <- grid[grid$scenario == scenario & grid$scoring_label == scoring_label, ]
  rows <- rows[order(rows$n_person), ]
  if (nrow(rows) == 0) stop("No grid rows for that scenario/scoring combination.")
  ns <- rows$n_person

  if (n_target %in% ns) {
    row <- rows[rows$n_person == n_target, ][1, ]
    return(list(
      mode = "exact_grid_point",
      n_used = n_target,
      power_estimate = row$sig_rate,
      power_source = "published sig_rate at this exact N",
      beta = row$beta_median,
      se = row$se_median,
      singular_rate_low = row$singular_rate,
      singular_rate_high = row$singular_rate,
      wald_check = wald_power(row$beta_median, row$se_median)
    ))
  }

  if (n_target < min(ns) || n_target > max(ns)) {
    n_used <- if (n_target < min(ns)) min(ns) else max(ns)
    row <- rows[rows$n_person == n_used, ][1, ]
    return(list(
      mode = "clamped_extrapolation",
      n_used = n_used,
      power_estimate = row$sig_rate,
      power_source = paste0(
        "N = ", n_target, " is outside the validated grid range [",
        min(ns), ", ", max(ns), "]; showing the nearest published point (N = ",
        n_used, ") instead of extrapolating."
      ),
      beta = row$beta_median,
      se = row$se_median,
      singular_rate_low = row$singular_rate,
      singular_rate_high = row$singular_rate,
      wald_check = wald_power(row$beta_median, row$se_median)
    ))
  }

  lo <- rows[rows$n_person == max(ns[ns <= n_target]), ][1, ]
  hi <- rows[rows$n_person == min(ns[ns >= n_target]), ][1, ]

  se_interp <- .pd_loglog_interp(n_target, lo$n_person, lo$se_median, hi$n_person, hi$se_median)
  w <- (n_target - lo$n_person) / (hi$n_person - lo$n_person)
  beta_interp <- (1 - w) * lo$beta_median + w * hi$beta_median

  list(
    mode = "interpolated",
    n_used = n_target,
    power_estimate = wald_power(beta_interp, se_interp),
    power_source = paste0(
      "Wald Phi-transform of an SE interpolated (power-law) between the real ",
      "N = ", lo$n_person, " and N = ", hi$n_person, " grid points; beta ",
      "linearly interpolated between the same two points."
    ),
    beta = beta_interp,
    se = se_interp,
    singular_rate_low = min(lo$singular_rate, hi$singular_rate),
    singular_rate_high = max(lo$singular_rate, hi$singular_rate),
    wald_check = NA_real_
  )
}

#' Exact lookup (no interpolation) in the sim_07 grid, for the item- and
#' person-sensitive, larger-N design family. sim_07's glmm summary carries no
#' per-cell SE, and every published sig_rate at these N x k combinations is
#' already 100%, so interpolation would add machinery without adding
#' information; only exact published combinations are offered.
#'
#' @param scenario One of the five sim_07 scenario codes.
#' @param n_person One of 120, 300.
#' @param k_per_condition One of 15, 30.
#' @param model One of "base_condition", "condition_by_memory".
lookup_sim07_detection <- function(scenario, n_person, k_per_condition, model,
                                    grid = load_sim07_grid()) {
  row <- grid[grid$scenario == scenario & grid$n_person == n_person &
                grid$k_per_condition == k_per_condition & grid$model == model, ]
  if (nrow(row) == 0) {
    return(list(found = FALSE))
  }
  row <- row[1, ]
  list(
    found = TRUE,
    power_estimate = row$sig_rate,
    condition_beta = row$condition_beta_median,
    r2_marginal = row$r2_marginal_median,
    memory_interaction_sig_rate = row$memory_interaction_sig_rate
  )
}

#' Calibration report: predicted (Wald Phi-transform of the real published
#' beta/SE) vs actual published sig_rate, for every row of a detection grid
#' that carries both beta_median and se_median. Used both by the automated
#' test script and (optionally) surfaced in-app as a transparency footnote.
#'
#' @return A data.frame with one row per grid row and an `abs_error_pp`
#'   column (absolute error in percentage points).
calibration_report <- function(grid) {
  stopifnot(all(c("beta_median", "se_median", "sig_rate") %in% names(grid)))
  pred <- mapply(wald_power, grid$beta_median, grid$se_median)
  actual <- grid$sig_rate
  data.frame(
    grid[, setdiff(names(grid), character(0))],
    predicted_power = pred,
    actual_sig_rate = actual,
    abs_error_pp = abs(pred - actual) * 100,
    stringsAsFactors = FALSE
  )
}

## -------------------------------------------------------------------------
## Tab 4: Reliability decision aid
## A cautious Bayesian-style update table: entered evidence raises, lowers, or
## leaves unresolved confidence in specific interpretations. It does not
## compute posterior probabilities or certify a design.
## -------------------------------------------------------------------------

#' Implied average inter-item correlation from alpha and item count.
#'
#' Rearranges alpha = k*r / (1 + (k-1)*r). Returns NA for coefficients that
#' cannot be meaningfully inverted in the expected [0, 1) range.
implied_rbar_from_alpha <- function(alpha, k) {
  if (!is.numeric(alpha) || !is.numeric(k) || length(alpha) != 1 || length(k) != 1) {
    stop("alpha and k must be scalar numerics")
  }
  if (is.na(alpha) || is.na(k) || k <= 1 || alpha <= 0 || alpha >= 1) {
    return(NA_real_)
  }
  denom <- k - alpha * (k - 1)
  if (denom <= 0) return(NA_real_)
  alpha / denom
}

#' Normalize reported-design statuses used by the decision aid.
#'
#' New Shiny inputs use explicit yes/no/unclear strings. The older pure-function
#' interface accepted booleans, so keep that path for tests and scripted use.
#' @keywords internal
.pd_report_status <- function(status, fallback_bool) {
  if (is.null(status)) {
    return(if (isTRUE(fallback_bool)) "yes" else "no")
  }
  match.arg(status, c("yes", "no", "unclear"))
}

#' Cautious decision table for reliability reporting.
#'
#' This is deliberately qualitative. The labels are evidence updates, not
#' posterior probabilities, and every row is tied to a distinct inferential
#' target from the manuscript framework.
reliability_decision_aid <- function(k, alpha = NA_real_, p_bar = 0.55,
                                      coefficient_status = c("reported", "not_computable", "not_reported"),
                                      primary_claim = c("condition_effect", "person_score",
                                                        "delayed_retention", "generalize_words",
                                                        "construct_scoring"),
                                      analysis_model = c("unclear", "aggregate_anova",
                                                         "subject_item_anova",
                                                         "crossed_or_resampling"),
                                      descriptive_status = c("unclear", "raw_accuracy",
                                                             "participant_descriptives",
                                                             "model_estimated",
                                                             "raw_and_model"),
                                      denominator_policy = c("unclear", "fixed_denominator",
                                                             "unknown_only_variable",
                                                             "pretest_adjusted"),
                                      counterbalanced = FALSE,
                                      baseline_checked = FALSE,
                                      repeated_same_items = FALSE,
                                      counterbalance_status = NULL,
                                      baseline_status = NULL,
                                      repeated_testing_status = NULL,
                                      control_design = c("none", "no_test", "delayed_only",
                                                         "parallel_form", "control_items", "test_only"),
                                      scoring_rule = c("strict", "lenient", "partial", "recognition", "mixed"),
                                      high_load = FALSE,
                                      hand_scored = FALSE) {
  coefficient_status <- match.arg(coefficient_status)
  primary_claim <- match.arg(primary_claim)
  analysis_model <- match.arg(analysis_model)
  descriptive_status <- match.arg(descriptive_status)
  denominator_policy <- match.arg(denominator_policy)
  control_design <- match.arg(control_design)
  scoring_rule <- match.arg(scoring_rule)
  counterbalance_status <- .pd_report_status(counterbalance_status, counterbalanced)
  baseline_status <- .pd_report_status(baseline_status, baseline_checked)
  repeated_testing_status <- .pd_report_status(repeated_testing_status, repeated_same_items)
  stopifnot(k >= 2, p_bar >= 0, p_bar <= 1)

  rows <- list()
  add_row <- function(target, observation, update, action) {
    rows[[length(rows) + 1L]] <<- data.frame(
      Target = target,
      Observation = observation,
      `Bayesian-style update` = update,
      `Decision / report` = action,
      check.names = FALSE,
      stringsAsFactors = FALSE
    )
  }

  r_imp <- if (coefficient_status == "reported") implied_rbar_from_alpha(alpha, k) else NA_real_
  floor_ceiling <- p_bar < 0.15 || p_bar > 0.85

  if (coefficient_status == "not_computable") {
    add_row(
      "Person-score reliability",
      sprintf("Coefficient not computable; k = %d, mean accuracy = %.2f.", k, p_bar),
      "Lowers confidence that this score ranks learners; may raise confidence that an unknown-word screen did its job.",
      "Report the score distribution, floor/ceiling rates, zero-variance item counts, item set, and scoring rule instead of forcing alpha."
    )
  } else if (coefficient_status == "not_reported") {
    add_row(
      "Person-score reliability",
      sprintf("No coefficient reported; k = %d, mean accuracy = %.2f.", k, p_bar),
      "Leaves person-score reliability unresolved unless the score is not interpreted as a learner measure.",
      "If the score itself is interpreted, report alpha/KR-20 or a model-based reliability analogue with SEM and distributional context."
    )
  } else {
    obs <- if (is.na(r_imp)) {
      sprintf("alpha/KR-20 = %.2f with k = %d; implied rbar is not interpretable.", alpha, k)
    } else {
      sprintf("alpha/KR-20 = %.2f with k = %d implies average inter-item rbar = %.2f.", alpha, k, r_imp)
    }
    if (floor_ceiling) {
      add_row(
        "Person-score reliability",
        paste0(obs, sprintf(" Mean accuracy = %.2f flags floor/ceiling compression.", p_bar)),
        "Raises little confidence in person ranking until the distribution is inspected; alpha can be low because variance is compressed, or high because the score unit changed.",
        "Report score bands or conditional SEM, zero-variance item counts, and whether the coefficient is condition-specific rather than pooled across conditions."
      )
    } else if (!is.na(alpha) && alpha >= 0.90) {
      add_row(
        "Person-score reliability",
        obs,
        "Raises confidence only that this defined score separates learners; it does not raise confidence that a condition effect is valid.",
        "Keep the coefficient tied to this exact time point, condition, item set, and scoring rule; still diagnose assignment, testing schedule, and construct fit."
      )
    } else {
      add_row(
        "Person-score reliability",
        obs,
        "Moderately informs the learner-ranking question, but the update is conditional on the score definition and distribution.",
        "Report SEM, floor/ceiling rates, and any item-deletion rule; avoid treating a generic threshold as a pass/fail standard."
      )
    }
  }

  if (primary_claim %in% c("condition_effect", "delayed_retention", "construct_scoring",
                           "generalize_words", "person_score")) {
    if (descriptive_status == "unclear") {
      add_row(
        "Descriptive outcome scale",
        "Outcome descriptives are not reported or unclear.",
        "Leaves practical interpretation unresolved: the reader cannot see the observed accuracy level, floor/ceiling pressure, or response-scale size of the contrast.",
        "Report condition/time/scoring-specific proportion correct or score means, and state the unit of the SD/CI (participants, items, or model-estimated marginal means)."
      )
    } else if (descriptive_status == "raw_accuracy") {
      add_row(
        "Descriptive outcome scale",
        "Raw accuracy / proportion correct is reported.",
        "Raises readability of the outcome scale, but it is descriptive context rather than a replacement for the GLMM fixed effect or its uncertainty.",
        "Report numerator/denominator or cell proportions by condition/time/scoring; avoid treating a CI over item responses as independent evidence when responses are clustered by learners and words."
      )
    } else if (descriptive_status == "participant_descriptives") {
      add_row(
        "Descriptive outcome scale",
        "Participant score M/SD/95% CI is reported.",
        "Raises confidence in the distributional context for learner scores, but the CI usually describes participant means and does not by itself generalize the condition effect over words.",
        "State whether M/SD/CI are based on participant-level score means, and pair them with the item-level or crossed-model evidence used for the effect claim."
      )
    } else if (descriptive_status == "model_estimated") {
      add_row(
        "Descriptive outcome scale",
        "Model-estimated probabilities with 95% CI are reported.",
        "Raises interpretability of a GLMM/IRT result on the response scale, conditional on the model being correctly specified and reported.",
        "Also report the model formula, logit-scale fixed effect or contrast, SE/CI, participant/item terms, and convergence diagnostics; do not report probabilities alone."
      )
    } else if (descriptive_status == "raw_and_model") {
      add_row(
        "Descriptive outcome scale",
        "Both raw accuracy and model-estimated probabilities are reported.",
        "Raises confidence that readers can see both the observed response pattern and the model-based effect scale.",
        "Keep the two roles separate: raw accuracy describes the sample; model-estimated probabilities summarize the fitted estimand on the response scale."
      )
    }
  }

  if (denominator_policy == "unclear") {
    add_row(
      "Denominator / pretest-known items",
      sprintf("The denominator policy for the %d-item reported score is not reported or unclear.", k),
      "Leaves the score interpretation unresolved: the reader cannot tell whether the condition score means fixed target-set performance or unknown-only learning.",
      "Report whether pretest-correct participant-item observations were retained, excluded, or modeled; state the denominator used for each condition/time/scoring summary."
    )
  } else if (denominator_policy == "fixed_denominator") {
    add_row(
      "Denominator / pretest-known items",
      sprintf("A fixed condition denominator is retained (reported score has k = %d items; e.g., with 15 items, M = 6/15 = .40 if six items are correct).", k),
      "Raises clarity for descriptive reporting: count and proportion are linearly equivalent when every participant has the same condition denominator.",
      "Report both the count scale and proportion/percentage when helpful (e.g., M = 6.0/15, 40%). If pretest-known items remain, interpret the score as posttest performance on the full target set, not pure learning of unknown words."
    )
  } else if (denominator_policy == "unknown_only_variable") {
    add_row(
      "Denominator / pretest-known items",
      "Pretest-correct items are excluded, so the denominator can vary by participant, condition, or time point.",
      "Changes the estimand to performance among initially unknown items and lowers comparability of raw counts across participants/conditions unless denominators are explicit.",
      "Report excluded item counts and eligible denominators by condition (e.g., 13/15 eligible for a participant in condition A), use proportions or a model with the participant-item eligibility rule, and do not compute alpha as if everyone answered the same 15-item score."
    )
  } else if (denominator_policy == "pretest_adjusted") {
    add_row(
      "Denominator / pretest-known items",
      "Pretest-known status is modeled or adjusted rather than simply dropped from the denominator.",
      "Raises confidence that prior knowledge is addressed while preserving the target-item design, conditional on the model specification and missing/knownness rule.",
      "Report the pretest rule, model term or adjustment, and a sensitivity table showing whether conclusions change under fixed-denominator and unknown-only summaries."
    )
  }

  if (primary_claim %in% c("condition_effect", "delayed_retention", "generalize_words")) {
    if (analysis_model == "unclear") {
      add_row(
        "Analysis model / item treatment",
        "The analysis unit for the effect claim is not reported or unclear.",
        "Leaves confidence unresolved: a reviewer cannot tell whether the reported test treats words only as fixed score components or also evaluates item-level variability.",
        "Ask the author to state the analysis unit and whether items/words were modeled, resampled, or otherwise included in the uncertainty statement."
      )
    } else if (analysis_model == "aggregate_anova") {
      anova_update <- if (primary_claim == "generalize_words") {
        "Lowers confidence in generalization beyond the sampled words: participant-level ANOVA/t-test on aggregate scores does not estimate item-by-condition variability."
      } else {
        "Supports at most a narrow sampled-score mean contrast, conditional on assignment and baseline evidence; it leaves word-level generalization unresolved."
      }
      add_row(
        "Analysis model / item treatment",
        "Effect tested with participant-level ANOVA/t-test on total or mean scores.",
        anova_update,
        "Do not treat alpha as the repair. Ask for counterbalancing, item-level GLMM/IRT, by-item or item-resampling sensitivity, or narrow the claim to the sampled words and score definition."
      )
    } else if (analysis_model == "subject_item_anova") {
      add_row(
        "Analysis model / item treatment",
        "The report includes separate participant and item analyses.",
        "Raises confidence relative to participant-only ANOVA, but still requires reconciliation if participant and item conclusions diverge and does not by itself replace a crossed model.",
        "Report both analyses transparently, state the intended generalization population, and consider a crossed GLMM/IRT or item-resampling sensitivity when feasible."
      )
    } else if (analysis_model == "crossed_or_resampling") {
      add_row(
        "Analysis model / item treatment",
        "The report includes crossed item/participant modeling, item resampling, or D-study-style evidence.",
        "Raises confidence that the effect claim is evaluated beyond a participant-only aggregate, conditional on convergence, model specification, and the design facts below.",
        "Report model formula, random/fixed item terms, convergence or boundary diagnostics, and the estimand each analysis supports."
      )
    }

    if (counterbalance_status == "yes" && baseline_status == "yes") {
      add_row(
        "Condition-effect inference",
        "Word-condition assignment is counterbalanced and baseline vocabulary/proficiency balance is checked or modeled.",
        "Raises confidence that the fixed condition contrast is interpretable, conditional on the specified item-level model.",
        "Report the GLMM/IRT fixed effect, uncertainty interval, participant/item variance, coding scheme, and convergence or boundary diagnostics."
      )
    } else if (counterbalance_status == "unclear" || baseline_status == "unclear") {
      unclear <- paste(c(if (counterbalance_status == "unclear") "word-condition assignment" else NULL,
                         if (baseline_status == "unclear") "baseline-equivalence/modeling" else NULL),
                       collapse = " and ")
      reported_absent <- paste(c(if (counterbalance_status == "no") "counterbalancing" else NULL,
                                 if (baseline_status == "no") "baseline-equivalence/modeling" else NULL),
                               collapse = " and ")
      obs <- if (nzchar(reported_absent)) {
        paste0("Not reported or unclear: ", unclear, "; reported absent/problematic: ",
               reported_absent, ".")
      } else {
        paste0("Not reported or unclear: ", unclear, ".")
      }
      add_row(
        "Condition-effect inference",
        obs,
        "Leaves confidence unresolved for the treatment interpretation; missing design evidence is not supplied by a high alpha/KR-20 value.",
        "Code the design fact as not reported, ask for clarification if reviewing, or narrow the claim to the evidence actually reported."
      )
    } else {
      missing <- paste(c(if (counterbalance_status == "no") "counterbalancing" else NULL,
                         if (baseline_status == "no") "baseline-equivalence/modeling" else NULL),
                       collapse = " and ")
      add_row(
        "Condition-effect inference",
        paste0("Reported absent/problematic: ", missing, "."),
        "Lowers confidence in the treatment interpretation even if alpha is high; in the manuscript's upper-bound structural-confounding diagnostic, no coefficient can recover the missing assignment information.",
        "Treat alpha as secondary. Add counterbalancing, item fixed effects where estimable, baseline adjustment, or a narrower claim."
      )
    }
  }

  if (primary_claim == "delayed_retention" || repeated_testing_status %in% c("yes", "unclear")) {
    protected <- control_design %in% c("no_test", "delayed_only", "parallel_form", "control_items", "test_only")
    if (repeated_testing_status == "yes" && !protected) {
      add_row(
        "Delayed-retention / repeated-testing claim",
        paste0("Same target words are repeatedly tested; control design = ", control_design, "."),
        "Strongly lowers confidence that delayed gains are separable from test-induced learning; retrieval practice is part of the intervention.",
        "Report this as a design limitation, or add no-test, delayed-only, parallel-form, or control-item evidence before making a delayed-retention claim."
      )
    } else if (protected) {
      add_row(
        "Delayed-retention / repeated-testing claim",
        paste0("Repeated-testing risk is addressed with ", control_design, " evidence."),
        "Raises confidence that delayed performance is not only repeated exposure to the same target words.",
        "Report the control explicitly and keep tested items, learned words, exposure time, and item count distinct."
      )
    } else if (repeated_testing_status == "unclear") {
      add_row(
        "Delayed-retention / repeated-testing claim",
        "Whether the same target words were repeatedly tested is not reported or unclear.",
        "Leaves confidence unresolved for delayed-retention interpretation; absence of reporting is not evidence that test-induced learning was controlled.",
        "Code this as not reported, inspect instruments or appendices if available, and avoid treating delayed gains as separable from repeated exposure without control evidence."
      )
    } else {
      add_row(
        "Delayed-retention / repeated-testing claim",
        "The report indicates that the same target words were not repeatedly tested.",
        "Leaves delayed-retention claims dependent on the timing and form-equivalence evidence actually reported.",
        "If delayed retention is central, state whether forms are parallel and whether any no-test or delayed-only control was available."
      )
    }
  }

  if (primary_claim %in% c("construct_scoring", "condition_effect", "delayed_retention") ||
      scoring_rule != "strict" || isTRUE(hand_scored)) {
    if (scoring_rule %in% c("lenient", "partial", "recognition", "mixed") || isTRUE(hand_scored)) {
      format_need <- switch(
        scoring_rule,
        lenient = "response criteria showing that partial knowledge is intended, not overclaiming",
        partial = "ordinal or partial-credit rationale, ideally with an analysis matched to the 0/1/2 scale",
        recognition = "distractor and guessing diagnostics",
        mixed = "subtest-specific reporting before any composite score",
        strict = "response criteria and scorer consistency"
      )
      add_row(
        "Construct / scoring-rule interpretation",
        paste0("Scoring format = ", scoring_rule, if (hand_scored) "; hand-scored responses." else "."),
        "Updates the construct interpretation, not just reliability. Similar alpha values can support different conclusions when scoring rules define different knowledge states.",
        paste0("Report the scoring rationale and ", format_need, "; do not let a higher detection rate stand in for validation.")
      )
    } else {
      add_row(
        "Construct / scoring-rule interpretation",
        "Strict full-recall scoring is used.",
        "Raises confidence only for claims about full recall; leaves partial-knowledge and recognition claims unresolved.",
        "State that the estimand is full recall, or add separate evidence if the claim concerns any knowledge or recognition."
      )
    }
  }

  if (primary_claim == "generalize_words") {
    add_row(
      "Effect generalizability",
      sprintf("Claim extends beyond the sampled words; k = %d items in the entered score.", k),
      "Alpha leaves this question unresolved because it does not estimate between-word variability of the condition effect.",
      "Report item-by-condition slope SD, item bootstrap/resampling, or a D-study-style projection; with 15-30 words per condition, ask this question explicitly."
    )
  }

  if (isTRUE(high_load)) {
    add_row(
      "Memory / aptitude sorting",
      "High cognitive-load design flagged.",
      "Lowers confidence that high alpha alone reflects clean learning; high-load simulations showed very high alpha can track memory aptitude.",
      "Report or model vocabulary, memory, or proficiency covariates when theoretically relevant, and separate average effects from condition-by-aptitude moderation."
    )
  }

  decisions <- do.call(rbind, rows)
  risk_count <- sum(grepl("Lowers|Strongly lowers", decisions[["Bayesian-style update"]]))
  unresolved_count <- sum(grepl("unresolved|not evidence|not supplied", decisions[["Bayesian-style update"]],
                                ignore.case = TRUE))
  overall <- if (risk_count >= 2) {
    "Multiple observations lower confidence in the intended interpretation. The report should narrow the claim or add design/model evidence before relying on the coefficient."
  } else if (risk_count == 1) {
    "One observation lowers confidence in the intended interpretation. Treat the coefficient as conditional evidence and report the matching diagnostic."
  } else if (unresolved_count >= 2) {
    "Several observations leave the intended interpretation unresolved. Treat defaults as sensitivity settings, not as evidence reported by the study."
  } else if (unresolved_count == 1) {
    "One observation leaves the intended interpretation unresolved. Keep that uncertainty visible rather than replacing it with a default value."
  } else {
    "No major lowering update was triggered by the entered values, but this is not certification; it only routes the claim to matching evidence."
  }

  list(
    overall = overall,
    implied_rbar = r_imp,
    decisions = decisions
  )
}

## -------------------------------------------------------------------------
## Tab 5: Generate my simulation script
## Spans Figure 1's condition-effect and generalization branches by handing
## the user a runnable simulation of their own design rather than a point
## estimate.
## -------------------------------------------------------------------------

#' Build a self-contained, executable R script that simulates the user's
#' design with a crossed binomial GLMM. Binary scoring uses one Bernoulli
#' trial; partial credit uses two binomial trials with an observed 0/1/2 score.
#' following the pipeline conventions of
#' scripts/run_effect_generalizability_simulations.R (simulate_counterbalanced
#' + fit_selected_glmms): explicit seed, MCSE-annotated summary, one dataset
#' per replication.
#'
#' @param n_person Number of participants.
#' @param k_per_condition Items per condition (total items = 2 * k_per_condition,
#'   counterbalanced two-list design).
#' @param delta True condition effect on the logit scale.
#' @param person_slope_sd SD of the person-level random slope for condition.
#' @param item_slope_sd SD of the item-level random slope for condition.
#' @param scoring One of "strict", "lenient", "partial".
#' @param n_rep Number of Monte Carlo replications.
#' @param seed Integer seed.
#' @return A single character string: the full text of an executable R script.
generate_simulation_script <- function(n_person = 60, k_per_condition = 15,
                                        delta = 0.5, person_slope_sd = 0.1,
                                        item_slope_sd = 0.1,
                                        scoring = c("strict", "lenient", "partial"),
                                        n_rep = 500, seed = 20260628) {
  scoring <- match.arg(scoring)
  counts <- c(n_person, k_per_condition, n_rep)
  if (length(counts) != 3L || any(!is.finite(counts)) ||
      any(counts != floor(counts)) || n_person < 2 || k_per_condition < 1 || n_rep < 1) {
    stop("Participants, items, and replications must be whole numbers (participants >= 2; others >= 1).")
  }
  if (length(c(delta, person_slope_sd, item_slope_sd)) != 3L ||
      any(!is.finite(c(delta, person_slope_sd, item_slope_sd))) ||
      person_slope_sd < 0 || item_slope_sd < 0) {
    stop("Enter a finite effect and non-negative, finite slope SDs.")
  }
  if (length(seed) != 1L || !is.finite(seed) || seed != floor(seed) ||
      abs(seed) > .Machine$integer.max) stop("Enter an integer seed within R's integer range.")

  guessing <- switch(scoring, strict = 0, lenient = 0.2, partial = 0)
  participant_term <- if (person_slope_sd > 0) {
    "diag(1 + condition_c | participant)"
  } else {
    "(1 | participant)"
  }
  item_term <- if (item_slope_sd > 0) {
    "diag(1 + condition_c | word)"
  } else {
    "(1 | word)"
  }
  response_formula <- if (scoring == "partial") {
    "cbind(score, 2L - score)"
  } else {
    "correct"
  }
  fit_formula_text <- paste(
    response_formula, "~ condition_c +", participant_term, "+", item_term
  )
  dgp_fit_relation <- if (scoring == "lenient") {
    paste0(
      "Deliberate stress test: the DGP has a 0.20 lower asymptote, while ",
      "the fitted ordinary logistic GLMM does not estimate that asymptote."
    )
  } else {
    "Aligned: the fitted binomial GLMM matches the generated response family and random-slope structure."
  }

  fit_block <- paste0(
    "  fit <- tryCatch({\n",
    "    suppressWarnings(glmer(\n",
    "      formula = fit_formula,\n",
    "      data = dat,\n",
    "      family = binomial(),\n",
    "      nAGQ = 1L,\n",
    "      control = glmerControl(optimizer = \"bobyqa\", optCtrl = list(maxfun = 15000))\n",
    "    ))\n",
    "  }, error = function(e) e)\n",
    "  if (inherits(fit, \"error\")) {\n",
    "    return(tibble(\n",
    "      beta_condition = NA_real_, se_condition = NA_real_,\n",
    "      p_condition = NA_real_, covered_95 = NA, singular = NA,\n",
    "      converged = FALSE, error = conditionMessage(fit)\n",
    "    ))\n",
    "  }\n",
    "  co <- summary(fit)$coefficients\n",
    "  beta_hat <- unname(co[\"condition_c\", \"Estimate\"])\n",
    "  se_hat <- unname(co[\"condition_c\", \"Std. Error\"])\n",
    "  conv_messages <- fit@optinfo$conv$lme4$messages\n",
    "  opt_code <- fit@optinfo$conv$opt\n",
    "  tibble(\n",
    "    beta_condition = beta_hat,\n",
    "    se_condition = se_hat,\n",
    "    p_condition = unname(co[\"condition_c\", \"Pr(>|z|)\"]),\n",
    "    covered_95 = (beta_hat - qnorm(.975) * se_hat <= delta) &&\n",
    "      (delta <= beta_hat + qnorm(.975) * se_hat),\n",
    "    singular = isSingular(fit, tol = 1e-4),\n",
    "    converged = is.null(conv_messages) &&\n",
    "      (is.null(opt_code) || all(opt_code == 0)),\n",
    "    error = NA_character_\n",
    "  )\n"
  )

  response_block <- if (scoring == "partial") {
    paste0(
      "      # Partial credit (0/1/2): two binomial trials on the same latent\n",
      "      # p_correct. The fitted model uses cbind(score, 2 - score), so\n",
      "      # its response family is aligned with this simplified DGP.\n",
      "      score = rbinom(n(), 2, p_correct)\n"
    )
  } else {
    paste0(
      "      correct = rbinom(n(), 1, p_correct)\n"
    )
  }

  script <- paste0(
"#!/usr/bin/env Rscript\n",
"# Self-contained simulation script generated by the Design Planner app.\n",
"# Design: N = ", n_person, " participants, k = ", k_per_condition,
" items/condition (", 2 * k_per_condition, " total words, two-list\n",
"# counterbalanced), delta = ", delta, " (logit scale), person-slope SD = ",
person_slope_sd, ", item-slope SD = ", item_slope_sd, ",\n",
"# scoring = \"", scoring, "\", ", n_rep, " replications, seed = ", seed, ".\n",
"#\n",
"# Follows the crossed binomial GLMM pipeline convention of\n",
"# scripts/run_effect_generalizability_simulations.R (simulate_counterbalanced\n",
"# + fit_selected_glmms): one dataset per replication, explicit seed, and an\n",
"# MCSE-annotated summary table. This is a custom sensitivity analysis, not an\n",
"# exact answer, design certificate, or substitute for the manuscript's own\n",
"# published simulations.\n",
"\n",
"suppressPackageStartupMessages({\n",
"  library(dplyr)\n",
"  library(tidyr)\n",
"  library(lme4)\n",
"})\n",
"\n",
"required_lme4 <- package_version(\"2.0.6\")\n",
"if (packageVersion(\"lme4\") < required_lme4) {\n",
"  stop(\"This script requires lme4 2.0-6 or newer; installed version: \",\n",
"       as.character(packageVersion(\"lme4\")))\n",
"}\n",
"\n",
"set.seed(", seed, ")\n",
"\n",
"n_person <- ", n_person, "L\n",
"k_per_condition <- ", k_per_condition, "L\n",
"delta <- ", delta, "\n",
"person_slope_sd <- ", person_slope_sd, "\n",
"item_slope_sd <- ", item_slope_sd, "\n",
"guessing <- ", guessing, "\n",
"n_rep <- ", n_rep, "L\n",
"fit_formula <- ", fit_formula_text, "\n",
"fit_formula_label <- paste(deparse(fit_formula), collapse = \" \" )\n",
"dgp_fit_relation <- \"", dgp_fit_relation, "\"\n",
"validation_state <- \"Estimable but fragile\"\n",
"\n",
"inv_logit <- function(x) plogis(x)\n",
"\n",
"simulate_one <- function(rep_id) {\n",
"  total_words <- 2L * k_per_condition\n",
"  participant <- seq_len(n_person)\n",
"  list_id <- rep(c(0L, 1L), length.out = n_person)\n",
"  person_intercept <- rnorm(n_person, 0, 0.85)\n",
"  person_slope <- rnorm(n_person, 0, person_slope_sd)\n",
"\n",
"  word <- seq_len(total_words)\n",
"  item_intercept <- rnorm(total_words, 0, 0.55)\n",
"  item_slope <- rnorm(total_words, 0, item_slope_sd)\n",
"\n",
"  dat <- expand_grid(participant = participant, word = word) %>%\n",
"    mutate(\n",
"      list_id = list_id[participant],\n",
"      condition_num = as.integer((word %% 2L) == list_id),\n",
"      condition_c = condition_num - 0.5,\n",
"      condition = factor(if_else(condition_num == 1L, \"context\", \"decontext\"),\n",
"                          levels = c(\"decontext\", \"context\")),\n",
"      eta = -0.40 + person_intercept[participant] - item_intercept[word] +\n",
"        condition_c * (delta + person_slope[participant] + item_slope[word]),\n",
"      p_latent = inv_logit(eta),\n",
"      p_correct = guessing + (1 - guessing) * p_latent,\n",
response_block,
"    ) %>%\n",
"    mutate(participant = factor(participant), word = factor(word))\n",
"\n",
fit_block,
"}\n",
"\n",
"message(\"Running \", n_rep, \" replications...\")\n",
"raw <- purrr::map_dfr(seq_len(n_rep), function(r) {\n",
"  if (r %% 50 == 0) message(\"  rep \", r, \" / \", n_rep)\n",
"  dplyr::bind_cols(rep_id = r, simulate_one(r))\n",
"})\n",
"\n",
"# --- MCSE-annotated summary, following the repo's convention of reporting\n",
"# Monte Carlo standard errors alongside every simulation-based estimate\n",
"# (see scripts/compute_track1_mcse.R). For a proportion p estimated from\n",
"# independent usable replications, MCSE(p) = sqrt(p * (1 - p) / n).\n",
"prop_mcse <- function(p, n) {\n",
"  if (n > 0L && is.finite(p)) sqrt(p * (1 - p) / n) else NA_real_\n",
"}\n",
"n_estimable <- sum(!is.na(raw$beta_condition))\n",
"estimable_rate <- n_estimable / n_rep\n",
"sig_rate <- if (n_estimable > 0L) mean(raw$p_condition < .05, na.rm = TRUE) else NA_real_\n",
"sig_rate_mcse <- prop_mcse(sig_rate, n_estimable)\n",
"n_coverage <- sum(!is.na(raw$covered_95))\n",
"coverage_95 <- if (n_coverage > 0L) mean(raw$covered_95, na.rm = TRUE) else NA_real_\n",
"coverage_95_mcse <- prop_mcse(coverage_95, n_coverage)\n",
"n_singular <- sum(!is.na(raw$singular))\n",
"singular_rate <- if (n_singular > 0L) mean(raw$singular, na.rm = TRUE) else NA_real_\n",
"singular_rate_mcse <- prop_mcse(singular_rate, n_singular)\n",
"convergence_rate <- mean(raw$converged)\n",
"convergence_rate_mcse <- prop_mcse(convergence_rate, n_rep)\n",
"mean_bias <- if (n_estimable > 0L) mean(raw$beta_condition - delta, na.rm = TRUE) else NA_real_\n",
"rmse <- if (n_estimable > 0L) sqrt(mean((raw$beta_condition - delta)^2, na.rm = TRUE)) else NA_real_\n",
"\n",
"summary_tbl <- tibble::tibble(\n",
"  validation_state = validation_state,\n",
"  dgp_fit_relation = dgp_fit_relation,\n",
"  model_formula = fit_formula_label,\n",
"  condition_contrast = \"decontext = -0.5; context = +0.5\",\n",
"  covariance_structure = \"diag (independent intercept/slope where slope SD > 0)\",\n",
"  integration = \"Laplace (nAGQ = 1)\",\n",
"  R_version = as.character(getRversion()),\n",
"  lme4_version = as.character(packageVersion(\"lme4\")),\n",
"  reformulas_version = as.character(packageVersion(\"reformulas\")),\n",
"  n_person = n_person,\n",
"  k_per_condition = k_per_condition,\n",
"  delta = delta,\n",
"  person_slope_sd = person_slope_sd,\n",
"  item_slope_sd = item_slope_sd,\n",
"  scoring = \"", scoring, "\",\n",
"  n_rep = n_rep,\n",
"  estimable_rate = estimable_rate,\n",
"  sig_rate = sig_rate,\n",
"  sig_rate_mcse = sig_rate_mcse,\n",
"  beta_condition_median = median(raw$beta_condition, na.rm = TRUE),\n",
"  mean_bias = mean_bias,\n",
"  rmse = rmse,\n",
"  coverage_95 = coverage_95,\n",
"  coverage_95_mcse = coverage_95_mcse,\n",
"  singular_rate = singular_rate,\n",
"  singular_rate_mcse = singular_rate_mcse,\n",
"  convergence_rate = convergence_rate,\n",
"  convergence_rate_mcse = convergence_rate_mcse\n",
")\n",
"\n",
"print(summary_tbl)\n",
"# readr::write_csv(summary_tbl, \"my_design_simulation_summary.csv\")  # uncomment to save\n"
  )

  script
}
