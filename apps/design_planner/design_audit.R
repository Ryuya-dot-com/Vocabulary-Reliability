#!/usr/bin/env Rscript
# Pure, dependency-free design-graph validation for the Design Planner.
#
# This module deliberately does not infer nesting or crossing from facet names.
# Every relationship and every condition-varying facet must be supplied by the
# caller. The same contract is implemented in design_audit.js for the static
# Cloudflare-delivered frontend.

DESIGN_AUDIT_SCHEMA_VERSION <- "1.0.0"
DESIGN_AUDIT_STATES <- c(
  "Not identifiable",
  "Outside supported model class",
  "Estimable but fragile",
  "Within validated envelope"
)

.da_supported_assignment_modes <- c(
  "within_unit", "between_unit", "crossed_counterbalance"
)
.da_supported_model_roles <- c("random", "fixed", "omitted")
.da_supported_dependence <- c("iid", "diag", "us", "cs", "ar1")
.da_unsupported_dependence <- c(
  "spatial", "multiple_membership", "custom_residual",
  "informative_cluster_size"
)
.da_supported_slopes <- c("none", "diag", "us", "cs", "ar1")

.da_scalar_string <- function(x) {
  is.character(x) && length(x) == 1L && !is.na(x) && nzchar(trimws(x))
}

.da_scalar_logical <- function(x) {
  is.logical(x) && length(x) == 1L && !is.na(x)
}

.da_whole_number <- function(x, minimum = 0) {
  is.numeric(x) && length(x) == 1L && is.finite(x) &&
    x >= minimum && abs(x - round(x)) < .Machine$double.eps^0.5
}

.da_null_to_empty <- function(x) {
  if (is.null(x) || length(x) == 0L || is.na(x) || identical(x, "")) "" else x
}

.da_issue_frame <- function(issues) {
  if (length(issues) == 0L) {
    return(data.frame(
      code = character(), severity = character(), facet = character(),
      message = character(), action = character(),
      stringsAsFactors = FALSE
    ))
  }
  do.call(rbind, lapply(issues, function(x) {
    data.frame(
      code = x$code,
      severity = x$severity,
      facet = x$facet,
      message = x$message,
      action = x$action,
      stringsAsFactors = FALSE
    )
  }))
}

#' Audit a hierarchical/crossed study design before any numerical calculation.
#'
#' @param design A named list with `schema_version`, `units`, `assignment`,
#'   `facets`, and optional `validation_id`. See design_audit_fixtures.R for
#'   complete examples.
#' @param validated_ids Character vector of registry IDs whose full parameter
#'   envelope has already been validated. An ID match never overrides a fatal,
#'   unsupported, or warning condition.
#' @return A list containing a four-state decision, structured reasons,
#'   suggested lme4 random-effect terms, and claim boundaries.
audit_design_graph <- function(design, validated_ids = character()) {
  issues <- list()
  add_issue <- function(code, severity, facet = "", message, action) {
    issues[[length(issues) + 1L]] <<- list(
      code = code, severity = severity, facet = facet,
      message = message, action = action
    )
  }

  if (!is.list(design)) {
    stop("design must be a named list", call. = FALSE)
  }

  schema_version <- design$schema_version
  if (!identical(schema_version, DESIGN_AUDIT_SCHEMA_VERSION)) {
    add_issue(
      "schema_version", "fatal", "",
      sprintf(
        "Expected schema_version %s; received %s.",
        DESIGN_AUDIT_SCHEMA_VERSION,
        if (is.null(schema_version)) "<missing>" else as.character(schema_version)
      ),
      "Migrate the payload before evaluating the design."
    )
  }

  units <- design$units
  assignment <- design$assignment
  facets <- design$facets
  if (!is.list(units)) {
    add_issue(
      "units_missing", "fatal", "", "The units block is missing.",
      "Report assignment, sampling, observation, and analysis units separately."
    )
    units <- list()
  }
  if (!is.list(assignment)) {
    add_issue(
      "assignment_missing", "fatal", "", "The assignment block is missing.",
      "Report assignment mode, condition levels, and independent assignment replication."
    )
    assignment <- list()
  }
  if (!is.list(facets) || length(facets) == 0L) {
    add_issue(
      "facets_missing", "fatal", "", "No facets were supplied.",
      "Add every sampled or conditioned facet explicitly; do not infer them from labels."
    )
    facets <- list()
  }

  required_unit_fields <- c("assignment", "sampling", "observation", "analysis")
  for (field in required_unit_fields) {
    value <- units[[field]]
    present <- if (field %in% c("assignment", "sampling")) {
      is.character(value) && length(value) >= 1L && all(nzchar(trimws(value)))
    } else {
      .da_scalar_string(value)
    }
    if (!present) {
      add_issue(
        paste0(field, "_unit_missing"), "fatal", "",
        sprintf("The %s unit is missing or empty.", field),
        sprintf("Specify the %s unit independently of the other units.", field)
      )
    }
  }

  mode <- assignment$mode
  if (!.da_scalar_string(mode) || !(mode %in% .da_supported_assignment_modes)) {
    add_issue(
      "assignment_mode", "fatal", "",
      "Assignment mode must be within_unit, between_unit, or crossed_counterbalance.",
      "Describe how condition was assigned rather than inferring it from the analysis model."
    )
  }
  condition_levels <- assignment$condition_levels
  if (!.da_whole_number(condition_levels, 2)) {
    add_issue(
      "condition_levels", "fatal", "",
      "condition_levels must be an integer of at least two.",
      "Report every observed condition level."
    )
  }
  replication <- assignment$independent_units_per_condition
  replication_ok <- is.numeric(replication) && length(replication) >= 1L &&
    all(is.finite(replication)) && all(replication == round(replication)) &&
    all(replication >= 1)
  if (!replication_ok) {
    add_issue(
      "assignment_replication_missing", "fatal", "",
      "Independent assignment units per condition are missing or invalid.",
      "Count independent randomized or assigned units, not rows or repeated observations."
    )
  } else if (any(replication < 2L)) {
    add_issue(
      "assignment_not_replicated", "fatal", "",
      "At least one condition has fewer than two independent assignment units.",
      "Do not estimate a condition effect that is perfectly aliased with a single assignment unit."
    )
  }
  if (replication_ok && .da_whole_number(condition_levels, 2) &&
      !(length(replication) %in% c(1L, as.integer(condition_levels)))) {
    add_issue(
      "assignment_replication_length", "fatal", "",
      "independent_units_per_condition must have length one or one value per condition.",
      "Supply a common count or condition-specific counts."
    )
  }

  facet_ids <- character(length(facets))
  facet_parents <- character(length(facets))
  valid_facet <- rep(TRUE, length(facets))
  random_terms <- character()
  generalizes_over <- character()
  does_not_generalize_over <- character()

  for (i in seq_along(facets)) {
    facet <- facets[[i]]
    if (!is.list(facet)) {
      add_issue(
        "facet_type", "fatal", sprintf("facet_%d", i),
        "Each facet must be a named object.",
        "Supply id, parent, n_levels, condition_varies_within, generalization_target, model_role, dependence, and slope."
      )
      valid_facet[i] <- FALSE
      next
    }
    id <- facet$id
    if (!.da_scalar_string(id)) {
      id <- sprintf("facet_%d", i)
      add_issue(
        "facet_id", "fatal", id, "Facet id is missing or empty.",
        "Give every facet a stable unique id."
      )
      valid_facet[i] <- FALSE
    }
    facet_ids[i] <- id
    parent <- .da_null_to_empty(facet$parent)
    if (!.da_scalar_string(parent) && !identical(parent, "")) {
      add_issue(
        "facet_parent", "fatal", id, "Facet parent must be null or a single facet id.",
        "Encode each nesting edge explicitly."
      )
      valid_facet[i] <- FALSE
      parent <- ""
    }
    facet_parents[i] <- parent

    if (!.da_whole_number(facet$n_levels, 2)) {
      add_issue(
        "facet_levels", "fatal", id,
        "A modeled facet must contain at least two observed levels.",
        "Report the observed number of levels or treat the single level as fixed context."
      )
      valid_facet[i] <- FALSE
    }
    if (!.da_scalar_logical(facet$condition_varies_within)) {
      add_issue(
        "condition_variation", "fatal", id,
        "condition_varies_within must be explicitly true or false.",
        "Check the design matrix within this facet rather than guessing from its name."
      )
      valid_facet[i] <- FALSE
    }
    if (!.da_scalar_logical(facet$generalization_target)) {
      add_issue(
        "generalization_target", "fatal", id,
        "generalization_target must be explicitly true or false.",
        "State whether the claim extends beyond the observed levels of this facet."
      )
      valid_facet[i] <- FALSE
    }

    role <- facet$model_role
    dependence <- facet$dependence
    slope <- facet$slope
    if (!.da_scalar_string(role) || !(role %in% .da_supported_model_roles)) {
      add_issue(
        "model_role", "fatal", id,
        "model_role must be random, fixed, or omitted.",
        "Choose the role from the estimand and sampling process, not from the facet label."
      )
      valid_facet[i] <- FALSE
    }
    if (!.da_scalar_string(dependence) ||
        !(dependence %in% c(.da_supported_dependence, .da_unsupported_dependence))) {
      add_issue(
        "dependence", "fatal", id,
        "The dependence structure is missing or unknown.",
        "Use an explicit supported or unsupported structure code."
      )
      valid_facet[i] <- FALSE
    } else if (dependence %in% .da_unsupported_dependence) {
      add_issue(
        paste0("unsupported_", dependence), "unsupported", id,
        sprintf("Facet %s uses %s dependence, which this lme4-based app does not model.", id, dependence),
        "Stop numerical guidance and route to a model that represents this dependence directly."
      )
    }
    if (!.da_scalar_string(slope) || !(slope %in% .da_supported_slopes)) {
      add_issue(
        "slope_structure", "fatal", id,
        "slope must be none, diag, us, cs, or ar1.",
        "Specify the random-slope covariance structure explicitly."
      )
      valid_facet[i] <- FALSE
    }

    if (isTRUE(facet$condition_varies_within) && identical(role, "random") &&
        identical(slope, "none") && isTRUE(facet$generalization_target)) {
      add_issue(
        "missing_random_slope", "warning", id,
        sprintf("Condition varies within generalization facet %s, but its condition slope is omitted.", id),
        "Add a supported condition-slope structure or narrow the effect-generalization claim."
      )
      does_not_generalize_over <- c(does_not_generalize_over, id)
    }
    if (isFALSE(facet$condition_varies_within) && !identical(slope, "none")) {
      add_issue(
        "slope_not_estimable", "fatal", id,
        sprintf("Condition does not vary within %s, so a condition slope for that facet is not estimable.", id),
        "Remove the slope term; evaluate assignment-level replication and narrow heterogeneity claims."
      )
    }
    if (isTRUE(facet$generalization_target) && identical(role, "omitted")) {
      add_issue(
        "generalization_facet_omitted", "warning", id,
        sprintf("Facet %s is a generalization target but is omitted from the model.", id),
        "Model or resample this facet, or limit the claim to the observed levels."
      )
      does_not_generalize_over <- c(does_not_generalize_over, id)
    }
    if (identical(role, "random") && .da_whole_number(facet$n_levels, 2) &&
        facet$n_levels < 5L) {
      add_issue(
        "few_random_levels", "warning", id,
        sprintf("Facet %s has only %d observed levels; variance estimates may be boundary-sensitive.", id, as.integer(facet$n_levels)),
        "Report boundary diagnostics and use design-specific simulation; this is a warning, not a universal cutoff."
      )
    }

    if (identical(role, "random") && valid_facet[i]) {
      term <- if (identical(slope, "none")) {
        sprintf("(1 | %s)", id)
      } else {
        sprintf("%s(1 + condition_c | %s)", slope, id)
      }
      random_terms <- c(random_terms, term)
      if (isTRUE(facet$generalization_target) &&
          (!isTRUE(facet$condition_varies_within) || !identical(slope, "none"))) {
        generalizes_over <- c(generalizes_over, id)
      }
    } else if (isTRUE(facet$generalization_target) && !(id %in% does_not_generalize_over)) {
      does_not_generalize_over <- c(does_not_generalize_over, id)
    }
  }

  duplicate_ids <- unique(facet_ids[duplicated(facet_ids) & nzchar(facet_ids)])
  for (id in duplicate_ids) {
    add_issue(
      "duplicate_facet", "fatal", id,
      sprintf("Facet id %s is duplicated.", id),
      "Use one node per facet and stable globally unique level identifiers."
    )
  }

  known_ids <- unique(facet_ids[nzchar(facet_ids)])
  for (i in seq_along(facet_parents)) {
    parent <- facet_parents[i]
    id <- facet_ids[i]
    if (nzchar(parent) && !(parent %in% known_ids)) {
      add_issue(
        "unknown_parent", "fatal", id,
        sprintf("Facet %s names unknown parent %s.", id, parent),
        "Add the parent facet or remove the nesting edge."
      )
    }
    if (nzchar(parent) && identical(parent, id)) {
      add_issue(
        "self_parent", "fatal", id,
        sprintf("Facet %s cannot be its own parent.", id),
        "Correct the nesting graph."
      )
    }
  }

  parent_map <- stats::setNames(facet_parents, facet_ids)
  for (id in known_ids) {
    seen <- character()
    current <- id
    while (nzchar(current) && current %in% names(parent_map)) {
      if (current %in% seen) {
        add_issue(
          "parent_cycle", "fatal", id,
          sprintf("The nesting graph contains a cycle involving %s.", current),
          "Replace the cycle with an acyclic hierarchy; represent crossing by leaving parent empty."
        )
        break
      }
      seen <- c(seen, current)
      current <- parent_map[[current]]
    }
  }

  for (field in c("assignment", "sampling")) {
    refs <- units[[field]]
    if (is.character(refs)) {
      for (ref in refs) {
        if (!(ref %in% known_ids)) {
          add_issue(
            paste0("unknown_", field, "_unit"), "fatal", ref,
            sprintf("%s unit %s is not a declared facet.", tools::toTitleCase(field), ref),
            "Declare the facet and its relationships explicitly."
          )
        }
      }
    }
  }

  assignment_facets <- units$assignment
  if (.da_scalar_string(mode) && is.character(assignment_facets)) {
    idx <- match(assignment_facets, facet_ids)
    variation <- vapply(idx, function(j) {
      if (is.na(j) || !is.list(facets[[j]])) return(NA)
      facets[[j]]$condition_varies_within
    }, logical(1))
    if (mode %in% c("within_unit", "crossed_counterbalance") &&
        any(is.na(variation) | !variation)) {
      add_issue(
        "assignment_variation_mismatch", "fatal", "",
        sprintf("Assignment mode %s requires condition variation within every declared assignment facet.", mode),
        "Correct the assignment mode or the facet-level condition-variation declarations."
      )
    }
    if (identical(mode, "crossed_counterbalance") && length(assignment_facets) < 2L) {
      add_issue(
        "crossed_assignment_facets", "fatal", "",
        "crossed_counterbalance requires at least two crossed assignment facets.",
        "Name each crossed facet, such as participant and item."
      )
    }
  }

  issue_table <- .da_issue_frame(issues)
  has_fatal <- any(issue_table$severity == "fatal")
  has_unsupported <- any(issue_table$severity == "unsupported")
  has_warning <- any(issue_table$severity == "warning")
  validation_id <- if (.da_scalar_string(design$validation_id)) design$validation_id else ""

  state <- if (has_fatal) {
    "Not identifiable"
  } else if (has_unsupported) {
    "Outside supported model class"
  } else if (!has_warning && nzchar(validation_id) && validation_id %in% validated_ids) {
    "Within validated envelope"
  } else {
    "Estimable but fragile"
  }

  list(
    schema_version = DESIGN_AUDIT_SCHEMA_VERSION,
    state = state,
    can_compute = state %in% c("Estimable but fragile", "Within validated envelope"),
    issues = issue_table,
    random_effect_terms = unique(random_terms),
    formula_suggestion = if (length(random_terms)) {
      paste("outcome ~ condition_c +", paste(unique(random_terms), collapse = " + "))
    } else {
      NA_character_
    },
    claim_boundary = list(
      generalizes_over = unique(generalizes_over),
      does_not_generalize_over = unique(does_not_generalize_over)
    )
  )
}
