#!/usr/bin/env Rscript

# Build or verify the versioned, browser-consumable reference-grid artifact.
# The artifact contains exact published simulation rows only. It introduces no
# interpolation, extrapolation, or design-matching claim.

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("build_static_reference_grids.R requires jsonlite.")
}

args <- commandArgs(trailingOnly = TRUE)
write_mode <- "--write" %in% args
unknown_args <- setdiff(args, "--write")
if (length(unknown_args)) {
  stop("Unknown argument(s): ", paste(unknown_args, collapse = ", "))
}

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
this_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[1])))
data_dir <- file.path(this_dir, "data")
output_path <- file.path(data_dir, "reference_grids.json")

sim19_path <- file.path(data_dir, "sim19_grid.csv")
sim07_path <- file.path(data_dir, "sim07_grid.csv")
sim19 <- read.csv(sim19_path, stringsAsFactors = FALSE, check.names = FALSE)
sim07 <- read.csv(sim07_path, stringsAsFactors = FALSE, check.names = FALSE)

sim19 <- sim19[order(
  sim19$scenario, sim19$n_person, sim19$scoring_label, sim19$model
), , drop = FALSE]
sim07 <- sim07[order(
  sim07$scenario, sim07$n_person, sim07$k_per_condition, sim07$model
), , drop = FALSE]
rownames(sim19) <- NULL
rownames(sim07) <- NULL

stopifnot(
  nrow(sim19) == 30L,
  nrow(sim07) == 40L,
  setequal(unique(sim19$n_person), c(24, 60)),
  setequal(unique(sim07$n_person), c(120, 300)),
  setequal(unique(sim07$k_per_condition), c(15, 30)),
  all(sim19$n_rep > 0),
  all(sim07$n_rep > 0)
)

source_identity <- function(path, data) {
  list(
    file = basename(path),
    md5 = unname(tools::md5sum(path)),
    rows = nrow(data),
    columns = ncol(data)
  )
}

artifact <- list(
  schema_version = "1.0.0",
  artifact_role = "exact published simulation reference; not a transferable power calculator",
  generated_by = "apps/design_planner/build_static_reference_grids.R",
  families = list(
    list(
      id = "sim19_ecological_small",
      label = "Small ecological classroom simulation (sim_19)",
      lookup_mode = "exact_only",
      source_snapshot = source_identity(sim19_path, sim19),
      exact_coordinates = list(
        n_person = sort(unique(sim19$n_person)),
        scenario = sort(unique(sim19$scenario)),
        scoring_label = sort(unique(sim19$scoring_label))
      ),
      available_metrics = c(
        "estimable_rate", "singular_rate", "sig_rate", "beta_median",
        "beta_q25", "beta_q75", "se_median"
      ),
      limitations = c(
        "Rows are exact 500-replication results for the published sim_19 design only.",
        "The significance frequency is a detection-rate reference, not a transferable power estimate.",
        "Matching N and scoring does not establish assignment, item sampling, or model equivalence."
      ),
      rows = sim19
    ),
    list(
      id = "sim07_two_facet",
      label = "Participant × item generalizability simulation (sim_07)",
      lookup_mode = "exact_only",
      source_snapshot = source_identity(sim07_path, sim07),
      exact_coordinates = list(
        n_person = sort(unique(sim07$n_person)),
        k_per_condition = sort(unique(sim07$k_per_condition)),
        scenario = sort(unique(sim07$scenario)),
        model = sort(unique(sim07$model))
      ),
      available_metrics = c(
        "estimable_rate", "sig_rate", "condition_beta_median",
        "memory_interaction_sig_rate", "r2_marginal_median", "delta"
      ),
      limitations = c(
        "Rows are exact 500-replication results for the published two-facet sim_07 design only.",
        "This snapshot has no per-cell standard error or singular-fit field; the browser must not invent them.",
        "A 100% detection frequency in this grid cannot be transferred to a user-entered design."
      ),
      rows = sim07
    )
  )
)

rendered <- as.character(jsonlite::toJSON(
  artifact,
  auto_unbox = TRUE,
  dataframe = "rows",
  na = "null",
  null = "null",
  digits = 16,
  pretty = TRUE
))

if (write_mode) {
  writeLines(rendered, output_path, useBytes = TRUE)
  cat(sprintf("wrote %s\n", output_path))
}

if (!file.exists(output_path)) {
  stop("Missing reference-grid artifact; rerun with --write: ", output_path)
}
committed <- paste(readLines(output_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
if (!identical(committed, rendered)) {
  stop(
    "reference_grids.json diverges from bundled CSV sources; regenerate with:\n",
    "Rscript --vanilla apps/design_planner/build_static_reference_grids.R --write"
  )
}

cat(sprintf(
  "Reference grids verified: %d families, %d exact rows, schema %s.\n",
  length(artifact$families), nrow(sim19) + nrow(sim07), artifact$schema_version
))
