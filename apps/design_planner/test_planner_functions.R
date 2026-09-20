#!/usr/bin/env Rscript
# test_planner_functions.R
#
# Standalone validation script (run with: Rscript test_planner_functions.R).
# Asserts planner_functions.R's outputs against numbers published in the
# manuscript and in outputs/*.csv. Exits with a non-zero status (via stop())
# on any failed assertion, so it can be used as a CI gate as well as a
# one-off check.

this_dir <- {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  dirname(normalizePath(sub("^--file=", "", file_arg[1])))
}
source(file.path(this_dir, "planner_functions.R"))

n_checks <- 0L
n_failed <- 0L
check <- function(label, actual, expected, tol = 1e-6) {
  n_checks <<- n_checks + 1L
  ok <- isTRUE(all.equal(actual, expected, tolerance = tol))
  status <- if (ok) "OK  " else "FAIL"
  if (!ok) n_failed <<- n_failed + 1L
  fmt <- function(v) if (is.numeric(v)) paste(round(v, 5), collapse = ",") else paste(v, collapse = ",")
  cat(sprintf("[%s] %-70s actual=%s expected=%s\n", status, label, fmt(actual), fmt(expected)))
  invisible(ok)
}
check_true <- function(label, cond) {
  n_checks <<- n_checks + 1L
  ok <- isTRUE(cond)
  if (!ok) n_failed <<- n_failed + 1L
  cat(sprintf("[%s] %s\n", if (ok) "OK  " else "FAIL", label))
  invisible(ok)
}

## ---------------------------------------------------------------------------
## Exhaustive coverage: every bundled value the app can display
##
## The manuscript's Data and Code Availability statement says the test suite
## "checks every displayed value against the published summaries." The spot
## checks above anchor selected values to the manuscript's own numbers; the
## loops below close the claim exhaustively: every row of every bundled grid
## must be reproduced by the exact lookup path the app uses to display it.
## ---------------------------------------------------------------------------
cat("\nExhaustive coverage: all bundled grid rows via the app's lookup paths\n")

sim19_all <- load_sim19_grid()
sim19_mismatch <- 0L
for (i in seq_len(nrow(sim19_all))) {
  r <- sim19_all[i, ]
  pred <- predict_sim19_detection(r$scenario, r$scoring_label, r$n_person)
  ok <- isTRUE(all.equal(pred$power_estimate, r$sig_rate, tolerance = 1e-12)) &&
    isTRUE(all.equal(pred$singular_rate_low, r$singular_rate, tolerance = 1e-12)) &&
    isTRUE(all.equal(pred$singular_rate_high, r$singular_rate, tolerance = 1e-12)) &&
    isTRUE(all.equal(pred$beta, r$beta_median, tolerance = 1e-12)) &&
    isTRUE(all.equal(pred$se, r$se_median, tolerance = 1e-12)) &&
    identical(pred$mode, "exact_grid_point")
  if (!ok) sim19_mismatch <- sim19_mismatch + 1L
}
check("all sim19 grid rows reproduced exactly by predict_sim19_detection()",
      c(nrow(sim19_all) > 0, sim19_mismatch), c(TRUE, 0L))

sim07_all <- load_sim07_grid()
sim07_mismatch <- 0L
for (i in seq_len(nrow(sim07_all))) {
  r <- sim07_all[i, ]
  res <- lookup_sim07_detection(r$scenario, r$n_person, r$k_per_condition, r$model)
  ok <- isTRUE(res$found) &&
    isTRUE(all.equal(res$power_estimate, r$sig_rate, tolerance = 1e-12)) &&
    isTRUE(all.equal(res$condition_beta, r$condition_beta_median,
                     tolerance = 1e-12)) &&
    isTRUE(all.equal(res$r2_marginal, r$r2_marginal_median, tolerance = 1e-12))
  if (!ok) sim07_mismatch <- sim07_mismatch + 1L
}
check("all sim07 grid rows reproduced exactly by lookup_sim07_detection()",
      c(nrow(sim07_all) > 0, sim07_mismatch), c(TRUE, 0L))

specs_all <- load_effect_scenario_specs()
specs_mismatch <- 0L
for (i in seq_len(nrow(specs_all))) {
  r <- specs_all[i, ]
  # Tab 2/Tab 4 presets display these three fields; each must be finite and
  # the analytic projection built from them must be computable.
  sd_val <- effect_sampling_sd(120, 30, r$person_slope_sd, r$item_slope_sd,
                               r$memory_moderation, memory_adjusted = FALSE)
  ok <- all(is.finite(c(r$delta, r$person_slope_sd, r$item_slope_sd))) &&
    is.finite(sd_val) && sd_val > 0
  if (!ok) specs_mismatch <- specs_mismatch + 1L
}
check("all scenario-spec rows complete and projection-computable",
      c(nrow(specs_all) == 5, specs_mismatch), c(TRUE, 0L))

cat("=====================================================================\n")
cat("Tab 1: Alpha expectations vs manuscript Table 2 (theoretical rows)\n")
cat("=====================================================================\n")

# Published (track1_ssla_methods_forum_draft.md, Table 2):
# 15 items, r = .10/.15/.22 (theoretical) -> .63 / .73 / .81
# 30 items, r = .10/.15/.22 (theoretical) -> .77 / .84 / .89
a15 <- expected_alpha(15, c(.10, .15, .22))
a30 <- expected_alpha(30, c(.10, .15, .22))
check("k=15, r=.10/.15/.22 rounds to .63/.73/.81", pd_round_half_up(a15, 2), c(.63, .73, .81))
check("k=30, r=.10/.15/.22 rounds to .77/.84/.89", pd_round_half_up(a30, 2), c(.77, .84, .89))

flags_ceiling <- alpha_expectation_flags(k = 15, r_bar = .15, p_bar = 0.92, high_load = FALSE)
check_true("floor/ceiling flag triggers at p_bar = .92", flags_ceiling$floor_ceiling_flag)
flags_normal <- alpha_expectation_flags(k = 15, r_bar = .15, p_bar = 0.55, high_load = FALSE)
check_true("floor/ceiling flag silent at p_bar = .55", !flags_normal$floor_ceiling_flag)

flags_highload <- alpha_expectation_flags(k = 30, r_bar = .35, p_bar = 0.55, high_load = TRUE)
check_true("memory-sorting flag triggers when high_load and alpha > .90 (expected alpha here)",
           flags_highload$expected_alpha > 0.90 && flags_highload$memory_sorting_flag)

cat("\n=====================================================================\n")
cat("Tab 1: alpha_curve() sweep vs expected_alpha() (Tab 1 alpha-vs-k chart)\n")
cat("=====================================================================\n")

curve_ref <- alpha_curve(c(.10, .15, .22), k_max = 60)
check_true("alpha_curve default r-bar anchors return one row per (r_bar, k) for k = 2..60",
           nrow(curve_ref) == 3 * 59 && all(curve_ref$k >= 2 & curve_ref$k <= 60))
check_true("alpha_curve values equal expected_alpha() pointwise over the full grid",
           isTRUE(all.equal(curve_ref$alpha, expected_alpha(curve_ref$k, curve_ref$r_bar))))

curve_user <- alpha_curve(0.18, k_min = 2, k_max = 10)
check_true("alpha_curve also works for a single non-anchor r_bar (e.g. the user's typed r̄), still matching expected_alpha() pointwise",
           nrow(curve_user) == 9 &&
             isTRUE(all.equal(curve_user$alpha, expected_alpha(curve_user$k, 0.18))))

check_true("alpha_curve(k_max = k_min) degenerates to a single-k grid without error",
           isTRUE(all.equal(alpha_curve(.15, k_min = 15, k_max = 15)$alpha, expected_alpha(15, .15))))

cat("\n=====================================================================\n")
cat("Tab 2: Effect generalizability vs sim_07 analytic projection & Supplementary Table S1.6b\n")
cat("=====================================================================\n")

specs <- load_effect_scenario_specs()
stable <- specs[specs$scenario == "alpha_high_effect_stable", ]
item_sens <- specs[specs$scenario == "alpha_high_item_sensitive", ]

sd_stable <- effect_sampling_sd(120, 30, stable$person_slope_sd, stable$item_slope_sd,
                                 stable$memory_moderation, memory_adjusted = FALSE)
sd_item_sensitive <- effect_sampling_sd(120, 30, item_sens$person_slope_sd, item_sens$item_slope_sd,
                                         item_sens$memory_moderation, memory_adjusted = FALSE)

# 1) Reproduce the analytic CSV column exactly (same formula, same numbers):
proj_csv <- read.csv(file.path(this_dir, "..", "..", "outputs",
                                "simulation_07_effect_dstudy_projection.csv"),
                      stringsAsFactors = FALSE)
csv_stable <- proj_csv[proj_csv$scenario == "alpha_high_effect_stable" &
                          proj_csv$n_person == 120 & proj_csv$k_per_condition == 30, ]
csv_item_sensitive <- proj_csv[proj_csv$scenario == "alpha_high_item_sensitive" &
                                  proj_csv$n_person == 120 & proj_csv$k_per_condition == 30, ]
check("effect_sampling_sd (stable, N=120,k=30) matches outputs/simulation_07_effect_dstudy_projection.csv exactly",
      sd_stable, csv_stable$effect_sampling_sd_unmodeled[1])
check("effect_sampling_sd (item-sensitive, N=120,k=30) matches outputs/simulation_07_effect_dstudy_projection.csv exactly",
      sd_item_sensitive, csv_item_sensitive$effect_sampling_sd_unmodeled[1])

# 2) Round to 3dp and compare to the task's stated targets / Supplementary
# Table S1.6b:
cat(sprintf("Analytic projection (this implementation): stable = %.4f, item-sensitive = %.4f\n",
            sd_stable, sd_item_sensitive))
cat("Supplementary Table S1.6b (500-rep Monte Carlo latent_effect_sd, NOT the analytic projection): stable = .008, item-sensitive = .086\n")
check("stable projection rounds to .008 (matches Supplementary Table S1.6b exactly)", round(sd_stable, 3), 0.008)
check_true(
  "item-sensitive projection (.084) within 0.005 of Supplementary Table S1.6b's empirical .086 (analytic-vs-Monte-Carlo gap, documented; not a defect)",
  abs(sd_item_sensitive - 0.086) < 0.005
)

curve <- effect_generalizability_curve(120, item_sens$person_slope_sd, item_sens$item_slope_sd,
                                        item_sens$memory_moderation)
check_true("effect_generalizability_curve returns one row per k in c(5,10,15,30,60,100)",
           nrow(curve) == 6 && all(curve$k_per_condition == c(5, 10, 15, 30, 60, 100)))
check_true("projected SD decreases monotonically as items/condition increases",
           all(diff(curve$effect_sampling_sd_unmodeled) < 0))

check("bottleneck classification: item-sensitive scenario at N=120,k=30 is item-limited",
      effect_bottleneck(120, 30, item_sens$person_slope_sd, item_sens$item_slope_sd,
                         item_sens$memory_moderation),
      "items", tol = 0)

cat("\n=====================================================================\n")
cat("Tab 3: GLMM Wald-power calibration against sim_19 and sim_07 grids\n")
cat("=====================================================================\n")

sim19 <- load_sim19_grid()
cal19 <- calibration_report(sim19)
cat(sprintf("sim_19 grid: %d rows, max abs error = %.2f pp, mean abs error = %.2f pp\n",
            nrow(cal19), max(cal19$abs_error_pp), mean(cal19$abs_error_pp)))
n_over_15 <- sum(cal19$abs_error_pp > 15)
cat(sprintf("Points with |error| > 15pp: %d / %d\n", n_over_15, nrow(cal19)))
check_true("Wald Phi-transform of REAL published beta/SE stays within +/-15pp on every sim_19 point",
           n_over_15 == 0)

# Specific published points named in the task spec (Supplementary Material S6 /
# manuscript text):
p24_strict <- sim19[sim19$scenario == "partial_only_effect" & sim19$n_person == 24 &
                       sim19$scoring_label == "Strict full recall", ]
p24_lenient <- sim19[sim19$scenario == "partial_only_effect" & sim19$n_person == 24 &
                        sim19$scoring_label == "Lenient any knowledge", ]
p60_strict <- sim19[sim19$scenario == "partial_only_effect" & sim19$n_person == 60 &
                       sim19$scoring_label == "Strict full recall", ]
p60_lenient <- sim19[sim19$scenario == "partial_only_effect" & sim19$n_person == 60 &
                        sim19$scoring_label == "Lenient any knowledge", ]
check("N=24 strict sig_rate = 19.2% (bundled grid, exact copy of published value)",
      p24_strict$sig_rate, 0.192, tol = 0)
check("N=24 lenient sig_rate = 79.8% (bundled grid, exact copy of published value)",
      p24_lenient$sig_rate, 0.798, tol = 0)
check("N=60 strict sig_rate = 43.8% (bundled grid, exact copy of published value)",
      p60_strict$sig_rate, 0.438, tol = 0)
check("N=60 lenient sig_rate = 99.6% (bundled grid, exact copy of published value)",
      p60_lenient$sig_rate, 0.996, tol = 0)

tn24 <- sim19[sim19$scenario == "true_null_balanced" & sim19$n_person == 24, ]
tn60 <- sim19[sim19$scenario == "true_null_balanced" & sim19$n_person == 60, ]
check("true-null N=24 strict/lenient/partial Type I rates = 4.4%/4.4%/5.8%",
      tn24$sig_rate[match(c("Strict full recall", "Lenient any knowledge", "Partial credit"),
                          tn24$scoring_label)],
      c(0.044, 0.044, 0.058), tol = 0)
check("true-null N=60 strict/lenient/partial Type I rates = 4.0%/4.0%/4.2%",
      tn60$sig_rate[match(c("Strict full recall", "Lenient any knowledge", "Partial credit"),
                          tn60$scoring_label)],
      c(0.040, 0.040, 0.042), tol = 0)

strict_24 <- sim19[sim19$n_person == 24 & sim19$scoring_label == "Strict full recall", ]
cat(sprintf("Strict-scoring singular rate at N=24 across scenarios: %.1f%%-%.1f%%\n",
            100 * min(strict_24$singular_rate), 100 * max(strict_24$singular_rate)))
check_true("strict-scoring singular rate at N=24 falls in the published 12.8-28.4% risk band",
           min(strict_24$singular_rate) >= 0.126 && max(strict_24$singular_rate) <= 0.286)

# --- Decisive evidence for the Tab-3 design decision: a naive first-principles
# Wald SE formula (ignoring participant/item clustering) miscalibrates badly,
# which is why Tab 3 uses grid+interpolation instead of a free-form calculator.
naive_se <- function(n, k = 15, pbar = 0.5) sqrt(4 / (n * k * pbar * (1 - pbar)))
naive_pred <- with(sim19, mapply(function(b, n) {
  se <- naive_se(n)
  wald_power(b, se)
}, beta_median, n_person))
naive_err <- abs(naive_pred - sim19$sig_rate) * 100
cat(sprintf("Naive from-scratch Wald SE formula vs sim_19: %d / %d points exceed 15pp error (decisive evidence for grid mode)\n",
            sum(naive_err > 15), length(naive_err)))
check_true("naive first-principles SE formula fails calibration on MULTIPLE sim_19 points (motivates grid+interpolation mode)",
           sum(naive_err > 15) >= 2)

# Interpolation behavior
pred_interp <- predict_sim19_detection("partial_only_effect", "Strict full recall", 40)
check_true("interpolated N=40 prediction mode is 'interpolated'", pred_interp$mode == "interpolated")
check_true("interpolated N=40 power lies between the N=24 and N=60 published values",
           pred_interp$power_estimate > p24_strict$sig_rate && pred_interp$power_estimate < p60_strict$sig_rate)

pred_clamped <- predict_sim19_detection("partial_only_effect", "Strict full recall", 200)
check_true("out-of-range N=200 request is clamped to the nearest real grid point, not extrapolated",
           pred_clamped$mode == "clamped_extrapolation" && pred_clamped$n_used == 60)

# sim_07 100%-detection calibration point named in the task spec
sim07 <- load_sim07_grid()
lk <- lookup_sim07_detection("alpha_high_item_sensitive", 120, 30, "base_condition", grid = sim07)
check_true("sim_07 lookup found for alpha_high_item_sensitive, N=120, k=30, base_condition", lk$found)
check("sim_07 detection rate at that design point is 100%", lk$power_estimate, 1.0, tol = 0)

cat("\n=====================================================================\n")
cat("Tab 2: preset dropdown choices map label -> scenario code (regression)\n")
cat("=====================================================================\n")

## Regression test for a pre-existing bug found (and fixed) during Phase 0
## verification: t2_preset's choices used to be built with
## setNames(names(sim07_scenarios), names(sim07_scenarios)) -- label mapped
## to label -- so input$t2_preset held the display label (e.g. "High alpha,
## stable effect") instead of the scenario code, and the t2_preset
## observeEvent's `specs$scenario == input$t2_preset` lookup in app.R never
## matched any row: selecting any scenario silently did nothing. This test
## parses app.R's actual source (without running/launching the app) to
## extract the live `choices` expression for t2_preset's selectInput() and
## check its *values* are scenario codes, not labels -- so this exact bug
## class cannot silently return.
app_r_exprs <- as.list(parse(file.path(this_dir, "app.R"), keep.source = FALSE))

sim07_scenarios_expr <- Filter(function(e) {
  is.call(e) && identical(e[[1]], as.name("<-")) && identical(e[[2]], as.name("sim07_scenarios"))
}, app_r_exprs)
check_true("app.R defines sim07_scenarios exactly once at top level", length(sim07_scenarios_expr) == 1)

sim07_env <- new.env()
eval(sim07_scenarios_expr[[1]], envir = sim07_env)
app_sim07_scenarios <- get("sim07_scenarios", envir = sim07_env)

## `ui` is assigned twice at top level in app.R (the main navbarPage(...)
## build, then a later tagList() wrap to inject clientside JS) -- both are
## pure UI-construction expressions, safe to walk recursively.
ui_exprs <- Filter(function(e) {
  is.call(e) && identical(e[[1]], as.name("<-")) && identical(e[[2]], as.name("ui"))
}, app_r_exprs)
check_true("app.R assigns `ui` at top level", length(ui_exprs) >= 1)

find_calls <- function(expr, fname) {
  out <- list()
  rec <- function(e) {
    if (is.call(e)) {
      if (length(e) >= 1 && is.symbol(e[[1]]) && identical(as.character(e[[1]]), fname)) {
        out[[length(out) + 1]] <<- e
      }
      n <- length(e)
      if (n >= 2) for (i in 2:n) rec(e[[i]])  # index directly; as.list() on
      # calls containing `[i, ]`-style missing args errors on forced access
    }
  }
  rec(expr)
  out
}
select_calls <- unlist(lapply(ui_exprs, find_calls, fname = "selectInput"), recursive = FALSE)
t2_preset_calls <- Filter(function(e) {
  args <- as.list(e)
  length(args) >= 2 && identical(args[[2]], "t2_preset")
}, select_calls)
check_true("app.R's UI contains exactly one selectInput(\"t2_preset\", ...) call", length(t2_preset_calls) == 1)

t2_preset_choices_arg <- as.list(t2_preset_calls[[1]])[["choices"]]
check_true("t2_preset selectInput has a `choices` argument", !is.null(t2_preset_choices_arg))
t2_preset_choices <- eval(t2_preset_choices_arg, envir = sim07_env)
t2_preset_scenario_values <- t2_preset_choices[t2_preset_choices != "custom"]

check_true("t2_preset dropdown values are scenario codes, not display labels (regression guard)",
           all(t2_preset_scenario_values %in% unname(app_sim07_scenarios)))
check_true("t2_preset dropdown offers all five published scenario codes",
           setequal(t2_preset_scenario_values, unname(app_sim07_scenarios)))

cat("\n=====================================================================\n")
cat("Tab 4: Reliability decision aid -- cautious update logic\n")
cat("=====================================================================\n")

check("implied_rbar_from_alpha(.73, k=15) inverts the alpha formula",
      pd_round_half_up(implied_rbar_from_alpha(.73, 15), 2), .15)
check_true("implied_rbar_from_alpha() returns NA for non-invertible alpha values",
           is.na(implied_rbar_from_alpha(1, 15)) && is.na(implied_rbar_from_alpha(-.2, 15)))

aid_retest <- reliability_decision_aid(
  k = 15, alpha = .874, p_bar = .55, coefficient_status = "reported",
  primary_claim = "delayed_retention", counterbalanced = TRUE,
  baseline_checked = TRUE, repeated_same_items = TRUE,
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid flags repeated same-item testing without control as lowering confidence",
           any(grepl("Strongly lowers confidence", aid_retest$decisions[["Bayesian-style update"]])))
check_true("decision aid returns the delayed-retention row for delayed-retention claims",
           any(aid_retest$decisions$Target == "Delayed-retention / repeated-testing claim"))

aid_screen <- reliability_decision_aid(
  k = 30, alpha = NA_real_, p_bar = 0, coefficient_status = "not_computable",
  primary_claim = "person_score", counterbalanced = FALSE,
  baseline_checked = FALSE, repeated_same_items = FALSE,
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid treats an all-zero/not-computable score as screen evidence, not alpha failure",
           grepl("unknown-word screen", aid_screen$decisions[["Bayesian-style update"]][1]))

aid_generalize <- reliability_decision_aid(
  k = 30, alpha = .84, p_bar = .55, coefficient_status = "reported",
  primary_claim = "generalize_words", counterbalanced = TRUE,
  baseline_checked = TRUE, repeated_same_items = FALSE,
  control_design = "none", scoring_rule = "recognition"
)
check_true("decision aid routes generalization claims to item-slope/bootstrap/D-study evidence",
           any(grepl("item-by-condition slope SD", aid_generalize$decisions[["Decision / report"]])))

aid_unclear_design <- reliability_decision_aid(
  k = 15, alpha = .87, p_bar = .55, coefficient_status = "reported",
  primary_claim = "condition_effect",
  counterbalance_status = "unclear",
  baseline_status = "unclear",
  repeated_testing_status = "unclear",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid treats unreported assignment/baseline facts as unresolved, not as default evidence",
           any(grepl("not reported or unclear", aid_unclear_design$decisions$Observation,
                     ignore.case = TRUE)) &&
             any(grepl("missing design evidence is not supplied",
                       aid_unclear_design$decisions[["Bayesian-style update"]])))
check_true("decision aid treats unclear repeated same-item testing as unresolved for delayed/testing interpretation",
           any(grepl("not reported or unclear",
                     aid_unclear_design$decisions$Observation,
                     ignore.case = TRUE)))

aid_anova_generalize <- reliability_decision_aid(
  k = 30, alpha = .84, p_bar = .55, coefficient_status = "reported",
  primary_claim = "generalize_words",
  analysis_model = "aggregate_anova",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid flags participant-level ANOVA as insufficient for word-generalization claims",
           any(aid_anova_generalize$decisions$Target == "Analysis model / item treatment") &&
             any(grepl("Lowers confidence in generalization beyond the sampled words",
                       aid_anova_generalize$decisions[["Bayesian-style update"]])))

aid_anova_narrow <- reliability_decision_aid(
  k = 30, alpha = .84, p_bar = .55, coefficient_status = "reported",
  primary_claim = "condition_effect",
  analysis_model = "aggregate_anova",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid treats participant-level ANOVA as narrow sampled-score evidence, not automatic rejection",
           any(grepl("narrow sampled-score mean contrast",
                     aid_anova_narrow$decisions[["Bayesian-style update"]])))

aid_raw_accuracy <- reliability_decision_aid(
  k = 30, alpha = .84, p_bar = .55, coefficient_status = "reported",
  primary_claim = "condition_effect",
  analysis_model = "crossed_or_resampling",
  descriptive_status = "raw_accuracy",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid treats raw accuracy as descriptive context, not a GLMM replacement",
           any(aid_raw_accuracy$decisions$Target == "Descriptive outcome scale") &&
             any(grepl("descriptive context rather than a replacement for the GLMM fixed effect",
                       aid_raw_accuracy$decisions[["Bayesian-style update"]])))

aid_raw_and_model <- reliability_decision_aid(
  k = 30, alpha = .84, p_bar = .55, coefficient_status = "reported",
  primary_claim = "condition_effect",
  analysis_model = "crossed_or_resampling",
  descriptive_status = "raw_and_model",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid distinguishes raw descriptives from model-estimated probabilities",
           any(grepl("raw accuracy describes the sample; model-estimated probabilities summarize the fitted estimand",
                     aid_raw_and_model$decisions[["Decision / report"]])))

aid_fixed_denominator <- reliability_decision_aid(
  k = 15, alpha = .75, p_bar = .40, coefficient_status = "reported",
  primary_claim = "condition_effect",
  descriptive_status = "participant_descriptives",
  denominator_policy = "fixed_denominator",
  analysis_model = "crossed_or_resampling",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid treats 6/15 and .40 as equivalent under a fixed denominator",
           any(grepl("6/15 = .40", aid_fixed_denominator$decisions$Observation,
                     fixed = TRUE)))

aid_variable_denominator <- reliability_decision_aid(
  k = 15, alpha = .75, p_bar = .40, coefficient_status = "reported",
  primary_claim = "condition_effect",
  descriptive_status = "participant_descriptives",
  denominator_policy = "unknown_only_variable",
  analysis_model = "crossed_or_resampling",
  counterbalance_status = "yes",
  baseline_status = "yes",
  repeated_testing_status = "no",
  control_design = "none", scoring_rule = "strict"
)
check_true("decision aid flags pretest-known item exclusion as a variable-denominator estimand change",
           any(grepl("denominator can vary", aid_variable_denominator$decisions$Observation,
                     ignore.case = TRUE)) &&
             any(grepl("do not compute alpha as if everyone answered the same 15-item score",
                       aid_variable_denominator$decisions[["Decision / report"]])))

cat("\n=====================================================================\n")
cat("Tab 5: preset dropdown data -- values match effect_scenario_specs.csv\n")
cat("=====================================================================\n")

# The five scenario codes offered by app.R's t4_preset dropdown (identical
# set to sim07_scenarios/t3_07_scenario in app.R). Verified here at the data
# level -- load_effect_scenario_specs() is exactly what the app's t4_preset
# observeEvent looks up -- since app.R's UI/server wiring itself needs a live
# Shiny session to exercise (see the shiny::testServer smoke test run
# alongside this script).
specs4 <- load_effect_scenario_specs()
t4_preset_codes <- c("alpha_high_effect_stable", "alpha_high_item_sensitive",
                      "alpha_high_person_sensitive", "recognition_alpha_low_effect_stable",
                      "high_load_memory_moderated")
check_true("every t4_preset scenario code has exactly one matching row in effect_scenario_specs.csv",
           all(vapply(t4_preset_codes, function(code) sum(specs4$scenario == code) == 1, logical(1))))

check("t4_preset 'alpha_high_item_sensitive' fills (delta, person_slope_sd, item_slope_sd) matching effect_scenario_specs.csv",
      unlist(specs4[specs4$scenario == "alpha_high_item_sensitive",
                     c("delta", "person_slope_sd", "item_slope_sd")], use.names = FALSE),
      c(0.75, 0.05, 0.65), tol = 0)
check("t4_preset 'alpha_high_person_sensitive' fills (delta, person_slope_sd, item_slope_sd) matching effect_scenario_specs.csv",
      unlist(specs4[specs4$scenario == "alpha_high_person_sensitive",
                     c("delta", "person_slope_sd", "item_slope_sd")], use.names = FALSE),
      c(0.75, 0.65, 0.05), tol = 0)
check("t4_preset 'high_load_memory_moderated' fills (delta, person_slope_sd, item_slope_sd) matching effect_scenario_specs.csv",
      unlist(specs4[specs4$scenario == "high_load_memory_moderated",
                     c("delta", "person_slope_sd", "item_slope_sd")], use.names = FALSE),
      c(0.55, 0.2, 0.15), tol = 0)

cat("\n=====================================================================\n")
cat("Tab 5: Generated simulation script executes end-to-end (reduced reps)\n")
cat("=====================================================================\n")

script_text <- generate_simulation_script(
  n_person = 40, k_per_condition = 10, delta = 0.6,
  person_slope_sd = 0.1, item_slope_sd = 0.3,
  scoring = "strict", n_rep = 20, seed = 99
)
check_true("generated script requires lme4 >= 2.0-6",
           grepl('required_lme4 <- package_version\\("2.0.6"\\)', script_text))
check_true("generated script fits explicit diagonal participant and item slopes",
           grepl("diag\\(1 \\+ condition_c \\| participant\\)", script_text) &&
             grepl("diag\\(1 \\+ condition_c \\| word\\)", script_text))
check_true("generated GLMM uses Laplace nAGQ=1 rather than the faster nAGQ=0 approximation",
           grepl("nAGQ = 1L", script_text, fixed = TRUE) &&
             !grepl("nAGQ = 0", script_text, fixed = TRUE))
check_true("generated DGP and fit share the centered numeric condition contrast",
           grepl("condition_c = condition_num - 0.5", script_text, fixed = TRUE) &&
             grepl("condition_c * (delta + person_slope[participant] + item_slope[word])",
                   script_text, fixed = TRUE) &&
             grepl("condition_c + diag", script_text, fixed = TRUE))
check_true("generated summary records model/version provenance and ADEMP diagnostics",
           all(vapply(c("dgp_fit_relation", "model_formula", "lme4_version",
                        "reformulas_version", "mean_bias", "coverage_95",
                        "singular_rate", "convergence_rate"),
                      grepl, logical(1), x = script_text, fixed = TRUE)))
tmp_script <- tempfile(fileext = ".R")
writeLines(script_text, tmp_script)

repo_root <- normalizePath(file.path(this_dir, "..", ".."))
run_res <- tryCatch({
  system2("Rscript", shQuote(tmp_script), stdout = TRUE, stderr = TRUE,
          env = character(0), wait = TRUE)
}, error = function(e) paste("ERROR:", conditionMessage(e)))
run_status <- attr(run_res, "status")
cat(paste(run_res, collapse = "\n"), "\n")
check_true("generated strict-scoring script (n_rep=20) runs via Rscript without error",
           is.null(run_status) || run_status == 0)
check_true("generated script's stdout includes a printed summary tibble",
           any(grepl("sig_rate", run_res)))

script_text_partial <- generate_simulation_script(
  n_person = 40, k_per_condition = 10, delta = 0.6,
  person_slope_sd = 0.1, item_slope_sd = 0.3,
  scoring = "partial", n_rep = 20, seed = 99
)
check_true("partial-credit DGP is fit as aligned two-trial binomial data, not a Gaussian LMM",
           grepl("cbind(score, 2L - score) ~ condition_c", script_text_partial, fixed = TRUE) &&
             !grepl("suppressWarnings(lmer(", script_text_partial, fixed = TRUE) &&
             !grepl("control = lmerControl", script_text_partial, fixed = TRUE))
tmp_script2 <- tempfile(fileext = ".R")
writeLines(script_text_partial, tmp_script2)
run_res2 <- tryCatch({
  system2("Rscript", shQuote(tmp_script2), stdout = TRUE, stderr = TRUE, wait = TRUE)
}, error = function(e) paste("ERROR:", conditionMessage(e)))
run_status2 <- attr(run_res2, "status")
cat(paste(run_res2, collapse = "\n"), "\n")
check_true("generated partial-credit script (n_rep=20) runs via Rscript without error",
           is.null(run_status2) || run_status2 == 0)

script_text_lenient <- generate_simulation_script(
  n_person = 40, k_per_condition = 10, delta = 0.6,
  person_slope_sd = 0.1, item_slope_sd = 0.3,
  scoring = "lenient", n_rep = 10, seed = 99
)
check_true("lenient-scoring lower-asymptote mismatch is explicitly labeled as a stress test",
           grepl("Deliberate stress test: the DGP has a 0.20 lower asymptote",
                 script_text_lenient, fixed = TRUE))

script_text_no_slopes <- generate_simulation_script(
  n_person = 40, k_per_condition = 10, delta = 0.6,
  person_slope_sd = 0, item_slope_sd = 0,
  scoring = "strict", n_rep = 10, seed = 99
)
check_true("zero-slope DGP does not force unidentifiable slope variance terms into the fit",
           grepl("correct ~ condition_c + (1 | participant) + (1 | word)",
                 script_text_no_slopes, fixed = TRUE) &&
             !grepl("diag(1 + condition_c", script_text_no_slopes, fixed = TRUE))

app_env <- new.env(parent = globalenv())
source(file.path(this_dir, "app.R"), local = app_env)
shiny::testServer(app_env$server, {
  session$setInputs(t2_n = 120, t2_k = 30, t2_person_slope_sd = .05,
                   t2_item_slope_sd = .15, t2_memory_mod = .65, t2_memory_adjusted = FALSE)
  check_true("Shiny unadjusted projection is participant-limited",
             grepl("Main bottleneck: participants", output$t2_bottleneck_display, fixed = TRUE))
  session$setInputs(t2_memory_adjusted = TRUE)
  check_true("Shiny memory adjustment updates both SD and bottleneck",
             grepl("0.0199", output$t2_sd_display, fixed = TRUE) &&
             grepl("Main bottleneck: items", output$t2_bottleneck_display, fixed = TRUE))
  for (k in c(15.5, NA_real_)) {
    session$setInputs(t1_k = k, t1_rbar = .15, t1_pbar = .55, t1_highload = FALSE)
    message_text <- tryCatch(output$t1_alpha_display, error = conditionMessage)
    check_true("Shiny invalid item count produces an actionable validation message",
               grepl("Enter a whole number of items", message_text, fixed = TRUE))
  }
  session$setInputs(t1_k = 15)
  check_true("Shiny item-count correction restores the result",
             grepl("0.73", output$t1_alpha_display, fixed = TRUE))
})
check_true("simulation generator rejects a negative SD before creating a script",
           inherits(try(generate_simulation_script(person_slope_sd = -.1), silent = TRUE), "try-error"))

cat("\n=====================================================================\n")
cat(sprintf("SUMMARY: %d checks, %d failed\n", n_checks, n_failed))
cat("=====================================================================\n")

if (n_failed > 0) {
  stop(n_failed, " check(s) failed.")
}
