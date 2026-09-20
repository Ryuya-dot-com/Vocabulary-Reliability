#!/usr/bin/env Rscript

# Build or verify the machine-readable inventory of the local Shiny companion.
# The committed artifact is deterministic. Machine-specific startup timing and
# memory observations belong to probe_app_runtime.R and are deliberately not
# written into this inventory.

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("build_app_inventory.R requires jsonlite.")
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
output_path <- file.path(data_dir, "app_inventory.json")

read_source <- function(name) {
  paste(readLines(file.path(this_dir, name), warn = FALSE, encoding = "UTF-8"), collapse = "\n")
}

top_level_functions <- function(path) {
  parsed <- parse(path, keep.source = FALSE)
  discovered <- vapply(parsed, function(expr) {
    if (!is.call(expr) || !as.character(expr[[1]]) %in% c("<-", "=")) return(NA_character_)
    if (!is.symbol(expr[[2]]) || !is.call(expr[[3]]) ||
        !identical(expr[[3]][[1]], as.name("function"))) return(NA_character_)
    as.character(expr[[2]])
  }, character(1))
  sort(stats::na.omit(discovered))
}

extract_dollar_ids <- function(source_text, object) {
  pattern <- paste0("\\b", object, "\\$[A-Za-z][A-Za-z0-9_]*")
  matches <- regmatches(source_text, gregexpr(pattern, source_text, perl = TRUE))[[1]]
  if (!length(matches) || identical(matches, "")) return(character())
  sort(unique(sub(paste0("^", object, "\\$"), "", matches)))
}

declared_input_ids <- function(path) {
  source_text <- paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  constructors <- paste(
    c("actionButton", "checkboxInput", "numericInput", "radioButtons",
      "selectInput", "sliderInput", "textInput"),
    collapse = "|"
  )
  pattern <- paste0("(?:", constructors, ")\\s*\\(\\s*\"[A-Za-z][A-Za-z0-9_]*\"")
  matches <- regmatches(source_text, gregexpr(pattern, source_text, perl = TRUE))[[1]]
  if (!length(matches) || identical(matches, "")) return(character())
  sort(unique(sub('^.*\"([A-Za-z][A-Za-z0-9_]*)\"$', "\\1", matches)))
}

stop_unless_equal <- function(actual, expected, label) {
  if (!identical(sort(actual), sort(expected))) {
    stop(
      label, " drifted.\nExpected: ", paste(sort(expected), collapse = ", "),
      "\nActual:   ", paste(sort(actual), collapse = ", ")
    )
  }
}

app_path <- file.path(this_dir, "app.R")
core_path <- file.path(this_dir, "planner_functions.R")
app_source <- read_source("app.R")
declared_inputs <- declared_input_ids(app_path)
referenced_inputs <- extract_dollar_ids(app_source, "input")
assigned_outputs <- extract_dollar_ids(app_source, "output")
app_functions <- top_level_functions(app_path)
core_functions <- top_level_functions(core_path)

expected_app_functions <- c(
  "details_panel", "does_not_license_note", "server", "start_here_note"
)
stop_unless_equal(app_functions, expected_app_functions, "Shiny top-level function catalog")

function_classes <- list(
  environment_path_helpers = c(".pd_data_dir", ".pd_this_dir"),
  pure_closed_form_or_decision = c(
    ".pd_loglog_interp", ".pd_report_status", "alpha_curve",
    "alpha_expectation_flags", "effect_bottleneck",
    "effect_generalizability_curve", "effect_sampling_sd", "expected_alpha",
    "implied_rbar_from_alpha", "pd_round_half_up", "reliability_decision_aid",
    "wald_power"
  ),
  read_only_bundled_snapshot_loaders = c(
    "load_effect_scenario_specs", "load_sim07_grid", "load_sim19_grid"
  ),
  deterministic_grid_evaluation_with_optional_snapshot_io = c(
    "calibration_report", "lookup_sim07_detection", "predict_sim19_detection"
  ),
  pure_offline_script_generator = "generate_simulation_script"
)
classified_functions <- unlist(function_classes, use.names = FALSE)
stop_unless_equal(core_functions, classified_functions, "R computation-function classification")

undeclared_references <- setdiff(referenced_inputs, declared_inputs)
if (length(undeclared_references)) {
  stop("input$ references not declared by a supported UI constructor: ",
       paste(undeclared_references, collapse = ", "))
}

feature_specs <- list(
  list(
    id = "alpha_expectations", tab = 1L, input_prefix = "t1_", output_prefix = "t1_",
    target = "person-score reliability",
    computation = c("expected_alpha", "alpha_expectation_flags", "alpha_curve"),
    public_static_coverage = "implemented_with_shared_R_JavaScript_golden_fixtures"
  ),
  list(
    id = "effect_generalizability", tab = 2L, input_prefix = "t2_", output_prefix = "t2_",
    target = "generalization beyond sampled participants and items",
    computation = c("effect_sampling_sd", "effect_bottleneck", "effect_generalizability_curve"),
    public_static_coverage = "implemented_only_for_strict_two_facet_shape_after_design_audit"
  ),
  list(
    id = "glmm_detection_reference", tab = 3L, input_prefix = "t3_", output_prefix = "t3_",
    target = "condition-effect detection and boundary-fit reference",
    computation = c("predict_sim19_detection", "lookup_sim07_detection", "calibration_report"),
    public_static_coverage = "implemented_as_exact_only_70_row_published_snapshot"
  ),
  list(
    id = "reliability_decision_aid", tab = 4L, input_prefix = "t5_", output_prefix = "t5_",
    target = "claim-evidence alignment without automatic pass/fail scoring",
    computation = c("reliability_decision_aid", "implied_rbar_from_alpha"),
    public_static_coverage = "implemented_as_reasoned_four_target_routing_and_reporting_prompts"
  ),
  list(
    id = "simulation_script_generator", tab = 5L, input_prefix = "t4_", output_prefix = "t4_",
    target = "offline sensitivity analysis for a typed two-condition design",
    computation = "generate_simulation_script",
    public_static_coverage = "not_executed_in_browser_or_synchronous_request"
  )
)

features <- lapply(feature_specs, function(feature) {
  prefix <- feature$input_prefix
  feature$inputs <- declared_inputs[startsWith(declared_inputs, prefix)]
  feature$outputs <- assigned_outputs[startsWith(assigned_outputs, feature$output_prefix)]
  feature$input_prefix <- NULL
  feature$output_prefix <- NULL
  feature
})

reactive_graph <- list(
  list(
    id = "t1_flags", kind = "reactive",
    reads_inputs = c("t1_highload", "t1_k", "t1_pbar", "t1_rbar"),
    writes_inputs = character(),
    feeds_outputs = c("t1_alpha_curve_plot", "t1_alpha_display", "t1_flags"),
    computation = "alpha_expectation_flags"
  ),
  list(
    id = "t1_alpha_curve", kind = "render",
    reads_inputs = c("t1_k", "t1_rbar"), writes_inputs = character(),
    feeds_outputs = "t1_alpha_curve_plot", computation = "alpha_curve"
  ),
  list(
    id = "t2_preset", kind = "observer",
    reads_inputs = "t2_preset",
    writes_inputs = c("t2_item_slope_sd", "t2_memory_mod", "t2_person_slope_sd"),
    feeds_outputs = character(), computation = "load_effect_scenario_specs"
  ),
  list(
    id = "t2_sd", kind = "reactive",
    reads_inputs = c(
      "t2_item_slope_sd", "t2_k", "t2_memory_adjusted", "t2_memory_mod",
      "t2_n", "t2_person_slope_sd"
    ),
    writes_inputs = character(), feeds_outputs = "t2_sd_display",
    computation = "effect_sampling_sd"
  ),
  list(
    id = "t2_bottleneck", kind = "render",
    reads_inputs = c("t2_item_slope_sd", "t2_k", "t2_memory_adjusted", "t2_memory_mod", "t2_n", "t2_person_slope_sd"),
    writes_inputs = character(), feeds_outputs = "t2_bottleneck_display",
    computation = "effect_bottleneck"
  ),
  list(
    id = "t2_curve", kind = "render",
    reads_inputs = c(
      "t2_item_slope_sd", "t2_memory_adjusted", "t2_memory_mod", "t2_n",
      "t2_person_slope_sd"
    ),
    writes_inputs = character(), feeds_outputs = "t2_curve_plot",
    computation = "effect_generalizability_curve"
  ),
  list(
    id = "t3_typical_preset", kind = "observer",
    reads_inputs = "t3_preset_typical",
    writes_inputs = c("t3_19_n", "t3_19_scenario", "t3_19_scoring", "t3_family"),
    feeds_outputs = character(), computation = "Shiny input updates only"
  ),
  list(
    id = "t3_result", kind = "reactive",
    reads_inputs = c(
      "t3_07_k", "t3_07_model", "t3_07_n", "t3_07_scenario", "t3_19_n",
      "t3_19_scenario", "t3_19_scoring", "t3_family"
    ),
    writes_inputs = character(),
    feeds_outputs = c("t3_mode_note", "t3_power_display", "t3_singular_note"),
    computation = c("predict_sim19_detection", "lookup_sim07_detection")
  ),
  list(
    id = "t3_calibration", kind = "render",
    reads_inputs = character(), writes_inputs = character(),
    feeds_outputs = "t3_calibration_table", computation = "calibration_report"
  ),
  list(
    id = "t5_decision", kind = "reactive",
    reads_inputs = declared_inputs[startsWith(declared_inputs, "t5_")],
    writes_inputs = character(),
    feeds_outputs = c("t5_decision_table", "t5_download_decision", "t5_overall", "t5_rbar"),
    computation = "reliability_decision_aid"
  ),
  list(
    id = "t4_preset", kind = "observer",
    reads_inputs = "t4_preset",
    writes_inputs = c("t4_delta", "t4_item_slope_sd", "t4_person_slope_sd"),
    feeds_outputs = character(), computation = "load_effect_scenario_specs"
  ),
  list(
    id = "t4_script", kind = "reactive",
    reads_inputs = c(
      "t4_delta", "t4_item_slope_sd", "t4_k", "t4_n", "t4_nrep",
      "t4_person_slope_sd", "t4_scoring", "t4_seed"
    ),
    writes_inputs = character(), feeds_outputs = c("t4_download", "t4_script_out"),
    computation = "generate_simulation_script"
  ),
  list(
    id = "t4_copy", kind = "observer",
    reads_inputs = "t4_copy", writes_inputs = character(), feeds_outputs = character(),
    computation = "send pd_copy_script client message"
  )
)

for (node in reactive_graph) {
  missing_inputs <- setdiff(c(node$reads_inputs, node$writes_inputs), declared_inputs)
  missing_outputs <- setdiff(node$feeds_outputs, assigned_outputs)
  if (length(missing_inputs) || length(missing_outputs)) {
    stop(
      "Reactive inventory drift in ", node$id,
      "; missing inputs: ", paste(missing_inputs, collapse = ", "),
      "; missing outputs: ", paste(missing_outputs, collapse = ", ")
    )
  }
}

source_identity <- function(name) {
  path <- file.path(this_dir, name)
  list(
    file = name,
    bytes = unname(file.info(path)$size),
    md5 = unname(tools::md5sum(path))
  )
}

data_identity <- function(name) {
  path <- file.path(data_dir, name)
  extension <- tools::file_ext(name)
  result <- list(
    file = name,
    bytes = unname(file.info(path)$size),
    md5 = unname(tools::md5sum(path))
  )
  if (identical(extension, "csv")) {
    frame <- utils::read.csv(path, check.names = FALSE)
    result$rows <- nrow(frame)
    result$columns <- ncol(frame)
  } else if (identical(extension, "json")) {
    parsed <- jsonlite::fromJSON(path, simplifyVector = FALSE)
    result$schema_version <- parsed$schema_version %||% NA_character_
  }
  result
}

`%||%` <- function(left, right) if (is.null(left)) right else left

data_files <- sort(setdiff(basename(list.files(data_dir, full.names = TRUE)), "app_inventory.json"))

inventory <- list(
  schema_version = "1.0.0",
  artifact_role = "deterministic Shiny feature, dependency, data, and lifecycle inventory",
  generated_by = "apps/design_planner/build_app_inventory.R",
  role_boundary = list(
    status = "optional_companion",
    primary_products = c("revised manuscript", "point-by-point response letter", "reproducible analysis record"),
    manuscript_understanding_requires_app = FALSE,
    reviewer_judgment_requires_app = FALSE,
    primary_result_reproduction_requires_app = FALSE,
    app_may_certify_design = FALSE,
    app_may_replace_unreported_evidence_with_defaults = FALSE,
    user_data_upload_or_persistence = FALSE,
    evidence_locations = c(
      "apps/design_planner/APP_GOVERNANCE.md",
      "README.md",
      "manuscript/track1_ssla_methods_forum_draft.md",
      "manuscript/supplement/supp_s0_map.md"
    )
  ),
  architecture = list(
    ui_server_layer = "apps/design_planner/app.R",
    computation_module = "apps/design_planner/planner_functions.R",
    static_public_frontend = "apps/design_planner_web",
    synchronous_R_API = "not_implemented_and_not_a_public_dependency",
    long_running_work = "offline only; never blocks a page request"
  ),
  discovered_contract = list(
    declared_input_count = length(declared_inputs),
    referenced_input_count = length(referenced_inputs),
    assigned_output_count = length(assigned_outputs),
    declared_inputs = declared_inputs,
    assigned_outputs = assigned_outputs,
    app_top_level_functions = app_functions,
    computation_functions = core_functions
  ),
  features = features,
  reactive_graph = reactive_graph,
  computation_function_classes = function_classes,
  dependencies = list(
    local_Shiny_runtime = list(required = c("shiny", "ggplot2"), network_after_install = FALSE),
    generated_offline_script = list(
      required = c("dplyr", "tidyr", "purrr", "tibble", "lme4 >= 2.0-6"),
      version_record_required = c("R", "lme4", "Matrix", "reformulas")
    ),
    deterministic_build_and_test = list(
      R = c("jsonlite", "tibble", "lme4 and generated-script dependencies for full suite"),
      JavaScript = c("Node.js", "jsdom", "Wrangler build tooling")
    )
  ),
  bundled_data = lapply(data_files, data_identity),
  source_files = lapply(
    c("app.R", "planner_functions.R", "run_local.R", "test_planner_functions.R"),
    source_identity
  ),
  validation = list(
    deterministic_inventory_command = "Rscript --vanilla apps/design_planner/build_app_inventory.R",
    regeneration_command = "Rscript --vanilla apps/design_planner/build_app_inventory.R --write",
    runtime_probe_command = "Rscript --vanilla apps/design_planner/probe_app_runtime.R",
    runtime_probe_interpretation = "machine-specific source/bootstrap diagnostic, not a hosted HTTP cold-start SLA",
    strict_startup_or_memory_threshold = FALSE,
    full_suite_command = "node scripts/run_design_planner_checks.mjs"
  ),
  lifecycle = list(
    source_of_truth = "versioned R functions plus deterministic artifacts and tests",
    static_first = TRUE,
    backend_loss_behavior = "the versioned public static snapshot remains usable",
    new_feature_gate = "must trace to a reviewer comment, manuscript claim gap, or reproducibility obligation",
    R_API_trigger = "only a bounded deterministic R calculation that cannot reasonably be ported or precomputed and has a specified deadline and static fallback",
    current_R_API_trigger_satisfied = FALSE,
    retirement_rule = "archive the static snapshot and provenance; do not keep a backend merely because it once existed"
  )
)

json_text <- jsonlite::toJSON(
  inventory, auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null", digits = 16
)
json_text <- paste0(json_text, "\n")

if (write_mode) {
  cat(json_text, file = output_path)
  message("Wrote ", output_path)
} else {
  if (!file.exists(output_path)) {
    stop("Missing ", output_path, "; regenerate with --write.")
  }
  committed <- paste0(paste(readLines(output_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n"), "\n")
  if (!identical(committed, json_text)) {
    stop("app_inventory.json is stale; inspect source drift and regenerate with --write.")
  }
  message(
    "Verified app inventory: ", length(features), " features, ",
    length(core_functions), " computation functions, ", length(reactive_graph),
    " reactive/render/observer nodes."
  )
}
