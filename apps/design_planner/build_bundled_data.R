# build_bundled_data.R -- provenance and verification for apps/design_planner/data/
#
# The Design Planner app bundles three CSV snapshots so it runs without the
# project's outputs/ folder. Every value in those snapshots is extracted
# mechanically from published project artifacts -- nothing is hand-typed:
#
#   data/sim19_grid.csv            <- outputs/simulation_19_ecological_small_within_model_summary.csv
#                                     (rows with term == "condition_num" for the
#                                     three memory-adjusted scoring models the app
#                                     exposes -- strict/lenient/partial, matching
#                                     Supplementary Material S6, including the
#                                     true-null calibration rows -- with a
#                                     human-readable scoring_label column added;
#                                     the strict_unadjusted sensitivity model is
#                                     repository-only)
#   data/sim07_grid.csv            <- outputs/simulation_07_effect_glmm_summary.csv
#                                     (all rows; display columns selected)
#   data/effect_scenario_specs.csv <- the scenario_specs tribble in
#                                     scripts/run_effect_generalizability_simulations.R
#                                     (that one expression is parsed and evaluated
#                                     in isolation; no simulation code runs)
#
# Default mode VERIFIES the committed snapshots against their sources and
# stops with an error on any divergence. Run with --write to (re)generate
# the snapshots after an upstream summary changes:
#
#   Rscript apps/design_planner/build_bundled_data.R          # verify only
#   Rscript apps/design_planner/build_bundled_data.R --write  # regenerate + verify

suppressPackageStartupMessages(library(tibble))

args <- commandArgs(trailingOnly = TRUE)
write_mode <- "--write" %in% args

this_file <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])
app_dir <- dirname(normalizePath(this_file))
repo_root <- dirname(dirname(app_dir))
data_dir <- file.path(app_dir, "data")

scoring_labels <- c(
  strict_adjusted = "Strict full recall",
  lenient_adjusted = "Lenient any knowledge",
  partial_lmm_adjusted = "Partial credit"
)

sim19_scenarios <- c(
  "balanced_moderate",
  "imperfect_counterbalance",
  "partial_only_effect",
  "true_null_balanced",
  "weak_moderated_missing"
)

# --- 1. sim19 grid ----------------------------------------------------------
sim19_src <- read.csv(
  file.path(repo_root, "outputs", "simulation_19_ecological_small_within_model_summary.csv")
)
sim19 <- sim19_src[sim19_src$term == "condition_num" &
                     sim19_src$scenario %in% sim19_scenarios &
                     sim19_src$model %in% names(scoring_labels), ]
sim19$scoring_label <- unname(scoring_labels[sim19$model])
stopifnot(
  nrow(sim19) == length(sim19_scenarios) * 2L * length(scoring_labels),
  !anyNA(sim19$scoring_label),
  setequal(unique(sim19$scenario), sim19_scenarios)
)
sim19 <- sim19[, c(
  "scenario", "scenario_label", "n_person", "model", "scoring_label", "term",
  "n_rep", "estimable_rate", "singular_rate", "sig_rate",
  "beta_median", "beta_q25", "beta_q75", "se_median"
)]

# --- 2. sim07 grid ----------------------------------------------------------
sim07_src <- read.csv(
  file.path(repo_root, "outputs", "simulation_07_effect_glmm_summary.csv")
)
sim07 <- sim07_src[, c(
  "scenario", "scenario_label", "n_person", "k_per_condition", "model",
  "n_rep", "estimable_rate", "sig_rate", "condition_beta_median",
  "memory_interaction_sig_rate", "r2_marginal_median", "delta"
)]

# --- 3. effect scenario specs (parsed from the generating script) -----------
gen_script <- file.path(repo_root, "scripts", "run_effect_generalizability_simulations.R")
exprs <- parse(gen_script, keep.source = FALSE)
is_specs_assign <- vapply(exprs, function(e) {
  is.call(e) && length(e) == 3L &&
    identical(e[[1L]], as.name("<-")) &&
    identical(e[[2L]], as.name("scenario_specs"))
}, logical(1))
stopifnot(sum(is_specs_assign) == 1L)
specs <- as.data.frame(eval(exprs[[which(is_specs_assign)]][[3L]]))

bundles <- list(
  "sim19_grid.csv" = sim19,
  "sim07_grid.csv" = sim07,
  "effect_scenario_specs.csv" = specs
)

canonical <- function(df) {
  df <- df[do.call(order, df[, intersect(names(df), names(df))]), , drop = FALSE]
  rownames(df) <- NULL
  df
}

for (name in names(bundles)) {
  path <- file.path(data_dir, name)
  fresh <- bundles[[name]]
  if (write_mode) {
    write.csv(fresh, path, row.names = FALSE)
    cat(sprintf("wrote   %s (%d rows)\n", name, nrow(fresh)))
  }
  committed <- read.csv(path)
  cmp <- all.equal(canonical(committed), canonical(fresh), tolerance = 1e-12)
  if (!isTRUE(cmp)) {
    stop(sprintf("bundled snapshot %s diverges from its source:\n%s",
                 name, paste(cmp, collapse = "\n")))
  }
  cat(sprintf("verified %s: matches source exactly (%d rows, %d cols)\n",
              name, nrow(fresh), ncol(fresh)))
}

cat("All bundled data snapshots verified against project sources.\n")
