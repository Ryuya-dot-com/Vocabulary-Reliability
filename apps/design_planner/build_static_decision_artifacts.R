#!/usr/bin/env Rscript

# Build or verify browser-facing decision rules and golden fixtures from the
# R decision core. The artifacts are deterministic: no timestamp, random seed,
# network access, simulation, or fitted model is involved.

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("build_static_decision_artifacts.R requires jsonlite.")
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
source(file.path(this_dir, "planner_functions.R"))
source(file.path(this_dir, "design_audit.R"))

read_json <- function(name) {
  jsonlite::fromJSON(file.path(data_dir, name), simplifyVector = FALSE)
}

source_identity <- function(name) {
  path <- file.path(data_dir, name)
  list(file = name, md5 = unname(tools::md5sum(path)))
}

target_registry <- read_json("inferential_target_registry.json")
design_fixtures <- read_json("design_audit_fixtures.json")
claim_fixtures <- read_json("claim_math_fixtures.json")
reference_grids <- read_json("reference_grids.json")

stopifnot(
  identical(target_registry$schema_version, "1.0.0"),
  length(target_registry$branches) == 4L,
  identical(design_fixtures$schema_version, DESIGN_AUDIT_SCHEMA_VERSION),
  identical(claim_fixtures$schema_version, "1.0.0"),
  identical(reference_grids$schema_version, "1.0.0")
)

decision_rules <- list(
  schema_version = "1.0.0",
  artifact_role = "public execution routing and numerical-release contract",
  generated_by = "apps/design_planner/build_static_decision_artifacts.R",
  source_contracts = list(
    source_identity("inferential_target_registry.json"),
    source_identity("design_audit.schema.json"),
    source_identity("validation_registry.json"),
    source_identity("reference_grids.json")
  ),
  pathways = list(
    list(
      id = "browser_static",
      runtime = "HTML/JavaScript plus versioned static artifacts",
      synchronous_request = TRUE,
      r_required = FALSE,
      allowed_work = c(
        "closed-form identities", "qualitative routing", "design-graph audit",
        "exact lookup in published grids", "reporting prompts"
      ),
      prohibited_work = c(
        "Monte Carlo simulation", "model fitting", "unregistered interpolation",
        "automatic promotion to a validated envelope"
      ),
      failure_mode = "explain the unavailable or blocked calculation without contacting a backend"
    ),
    list(
      id = "short_r_api",
      runtime = "stateless versioned R endpoint in a container",
      synchronous_request = TRUE,
      r_required = TRUE,
      allowed_work = c(
        "registered deterministic evaluation not yet ported to JavaScript",
        "schema validation and artifact-compatible formatting"
      ),
      prohibited_work = c(
        "Monte Carlo simulation", "arbitrary user code", "session state",
        "filesystem persistence", "automatic retry beyond the declared policy"
      ),
      failure_mode = "deadline-bound fallback to a static explanation or exact published row",
      implementation_status = "not_implemented_no_current_public_dependency"
    ),
    list(
      id = "offline_async",
      runtime = "offline R batch, reproducible job, or future asynchronous workflow",
      synchronous_request = FALSE,
      r_required = TRUE,
      allowed_work = c(
        "Monte Carlo simulation", "model fitting", "new validation-envelope generation",
        "adversarial DGP by fitted-model matrices"
      ),
      prohibited_work = c(
        "blocking a page request", "returning an unversioned result",
        "publishing a result before ADEMP and performance review"
      ),
      failure_mode = "retain the prior validated snapshot and report the failed job separately"
    )
  ),
  validation_states = list(
    list(
      state = "Not identifiable",
      can_show_formula = FALSE,
      can_run_assumption_sensitivity = FALSE,
      can_publish_validated_numeric = FALSE,
      required_action = "repair assignment or estimability before numerical work"
    ),
    list(
      state = "Outside supported model class",
      can_show_formula = FALSE,
      can_run_assumption_sensitivity = FALSE,
      can_publish_validated_numeric = FALSE,
      required_action = "route to a model that represents the declared dependence"
    ),
    list(
      state = "Estimable but fragile",
      can_show_formula = TRUE,
      can_run_assumption_sensitivity = TRUE,
      can_publish_validated_numeric = FALSE,
      required_action = "label assumptions and complete validation before a performance claim"
    ),
    list(
      state = "Within validated envelope",
      can_show_formula = TRUE,
      can_run_assumption_sensitivity = TRUE,
      can_publish_validated_numeric = TRUE,
      required_action = "report the exact registry and artifact versions with the result"
    )
  ),
  inferential_routes = lapply(target_registry$branches, function(branch) {
    list(
      id = branch$id,
      number = branch$number,
      question = branch$question,
      inferential_target = branch$inferential_target,
      requires_design_audit = branch$requires_design_audit,
      public_tool = branch$tool
    )
  }),
  calculations = list(
    list(
      id = "claim_router_reporting",
      pathway = "browser_static",
      public_status = "available",
      gate = "none; one branch must be evaluated per claim",
      fallback = "the same versioned reporting prompts remain available offline"
    ),
    list(
      id = "design_graph_audit",
      pathway = "browser_static",
      public_status = "available",
      gate = "schema-valid explicit assignment and facet graph",
      fallback = "return reason codes and suppress formula/numerical guidance"
    ),
    list(
      id = "expected_alpha_identity",
      pathway = "browser_static",
      public_status = "available",
      gate = "defined score unit and valid k/rbar/pbar inputs",
      fallback = "report invalid input; never substitute a default as observed evidence"
    ),
    list(
      id = "two_facet_effect_projection",
      pathway = "browser_static",
      public_status = "available_strict_shape_only",
      gate = "two-condition crossed participant-by-item design with both random slopes and no additional generalization slope",
      fallback = "block and require a new offline multifacet projection"
    ),
    list(
      id = "published_grid_exact_lookup",
      pathway = "browser_static",
      public_status = "available_reference_only",
      gate = "coordinate must be an exact row in the R-generated artifact",
      fallback = "show no row; interpolation and extrapolation are prohibited"
    ),
    list(
      id = "sim19_between_anchor_interpolation",
      pathway = "browser_static",
      public_status = "withheld_pending_browser_parity",
      gate = "N strictly between published anchors plus a dedicated parity fixture",
      fallback = "show the two exact bracketing rows without interpolation"
    ),
    list(
      id = "full_qualitative_decision_table",
      pathway = "browser_static",
      public_status = "partial_four_branch_route_available",
      gate = "reported evidence must remain distinct from defaults and missing facts",
      fallback = "use branch-level evidence, limitations, and reporting starter"
    ),
    list(
      id = "simulation_script_generation",
      pathway = "offline_async",
      public_status = "available_in_local_shiny_only",
      gate = "typed design plus explicit DGP/fitted-model provenance",
      fallback = "retain a reproducible design JSON without executing a model"
    ),
    list(
      id = "simulation_execution",
      pathway = "offline_async",
      public_status = "never_run_in_page_request",
      gate = "ADEMP specification, seed, version lock, and output destination",
      fallback = "continue serving the prior validated static snapshot"
    ),
    list(
      id = "registered_deterministic_r_evaluation",
      pathway = "short_r_api",
      public_status = "not_implemented_no_current_public_dependency",
      gate = "versioned endpoint, schema, deadline, reviewed envelope, and static fallback",
      fallback = "browser/static route; no indefinite waiting or hidden retry"
    )
  )
)

stopifnot(identical(
  vapply(decision_rules$validation_states, `[[`, character(1), "state"),
  DESIGN_AUDIT_STATES
))

normalize_design <- function(design) {
  design$units$assignment <- unlist(design$units$assignment, use.names = FALSE)
  design$units$sampling <- unlist(design$units$sampling, use.names = FALSE)
  design$assignment$condition_levels <- as.numeric(design$assignment$condition_levels)
  design$assignment$independent_units_per_condition <- as.numeric(unlist(
    design$assignment$independent_units_per_condition,
    use.names = FALSE
  ))
  design$facets <- lapply(design$facets, function(facet) {
    facet$n_levels <- as.numeric(facet$n_levels)
    facet
  })
  design
}

audit_goldens <- lapply(design_fixtures$fixtures, function(fixture) {
  validated_ids <- unlist(fixture$validated_ids, use.names = FALSE)
  if (is.null(validated_ids)) validated_ids <- character()
  result <- audit_design_graph(normalize_design(fixture$design), validated_ids)
  list(
    id = fixture$id,
    state = result$state,
    can_compute = result$can_compute,
    issue_codes = as.list(unname(result$issues$code)),
    formula_suggestion = result$formula_suggestion,
    claim_boundary = list(
      generalizes_over = as.list(result$claim_boundary$generalizes_over),
      does_not_generalize_over = as.list(result$claim_boundary$does_not_generalize_over)
    )
  )
})

claim_goldens <- list(
  alpha_expectation = lapply(claim_fixtures$alpha_expectation, function(fixture) {
    input <- fixture$inputs
    result <- alpha_expectation_flags(
      as.numeric(input$k), as.numeric(input$r_bar), as.numeric(input$p_bar),
      isTRUE(input$high_load)
    )
    list(
      id = fixture$id,
      alpha = result$expected_alpha,
      floor_ceiling_flag = result$floor_ceiling_flag,
      memory_sorting_flag = result$memory_sorting_flag
    )
  }),
  effect_projection = lapply(claim_fixtures$effect_projection, function(fixture) {
    input <- fixture$inputs
    list(
      id = fixture$id,
      sampling_sd = effect_sampling_sd(
        as.numeric(input$n_person), as.numeric(input$k_per_condition),
        as.numeric(input$person_slope_sd), as.numeric(input$item_slope_sd),
        as.numeric(input$memory_moderation), isTRUE(input$memory_adjusted)
      ),
      bottleneck = effect_bottleneck(
        as.numeric(input$n_person), as.numeric(input$k_per_condition),
        as.numeric(input$person_slope_sd), as.numeric(input$item_slope_sd),
        as.numeric(input$memory_moderation), isTRUE(input$memory_adjusted)
      )
    )
  })
)

find_reference_row <- function(family_id, predicate) {
  family <- reference_grids$families[[which(vapply(
    reference_grids$families,
    function(candidate) identical(candidate$id, family_id),
    logical(1)
  ))]]
  matches <- Filter(predicate, family$rows)
  stopifnot(length(matches) == 1L)
  matches[[1L]]
}

reference_goldens <- list(
  find_reference_row("sim19_ecological_small", function(row) {
    identical(row$scenario, "partial_only_effect") &&
      identical(as.numeric(row$n_person), 24) &&
      identical(row$scoring_label, "Lenient any knowledge")
  }),
  find_reference_row("sim19_ecological_small", function(row) {
    identical(row$scenario, "true_null_balanced") &&
      identical(as.numeric(row$n_person), 60) &&
      identical(row$scoring_label, "Strict full recall")
  }),
  find_reference_row("sim07_two_facet", function(row) {
    identical(row$scenario, "alpha_high_item_sensitive") &&
      identical(as.numeric(row$n_person), 120) &&
      identical(as.numeric(row$k_per_condition), 30) &&
      identical(row$model, "base_condition")
  })
)

golden_fixtures <- list(
  schema_version = "1.0.0",
  artifact_role = "R-computed cross-runtime golden outputs",
  generated_by = "apps/design_planner/build_static_decision_artifacts.R",
  source_contracts = list(
    source_identity("design_audit_fixtures.json"),
    source_identity("claim_math_fixtures.json"),
    source_identity("reference_grids.json")
  ),
  design_audit = audit_goldens,
  claim_math = claim_goldens,
  reference_grid_sentinels = reference_goldens
)

write_or_verify <- function(object, filename) {
  path <- file.path(data_dir, filename)
  rendered <- as.character(jsonlite::toJSON(
    object,
    auto_unbox = TRUE,
    dataframe = "rows",
    na = "null",
    null = "null",
    digits = 16,
    pretty = TRUE
  ))
  if (write_mode) {
    writeLines(rendered, path, useBytes = TRUE)
    cat(sprintf("wrote %s\n", path))
  }
  if (!file.exists(path)) {
    stop("Missing static artifact; rerun with --write: ", path)
  }
  committed <- paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  if (!identical(committed, rendered)) {
    stop(
      filename, " diverges from its R decision sources; regenerate with:\n",
      "Rscript --vanilla apps/design_planner/build_static_decision_artifacts.R --write"
    )
  }
}

write_or_verify(decision_rules, "decision_rules.json")
write_or_verify(golden_fixtures, "golden_test_fixtures.json")

cat(sprintf(
  "Decision artifacts verified: %d pathways, %d calculations, %d audit goldens, %d numeric goldens.\n",
  length(decision_rules$pathways),
  length(decision_rules$calculations),
  length(golden_fixtures$design_audit),
  length(golden_fixtures$claim_math$alpha_expectation) +
    length(golden_fixtures$claim_math$effect_projection)
))
