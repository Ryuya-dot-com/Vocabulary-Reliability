#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
this_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[1])))
source(file.path(this_dir, "design_audit.R"))

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("test_design_audit.R requires jsonlite to read the shared fixtures.")
}

payload <- jsonlite::fromJSON(
  file.path(this_dir, "data", "design_audit_fixtures.json"),
  simplifyVector = FALSE
)
stopifnot(identical(payload$schema_version, DESIGN_AUDIT_SCHEMA_VERSION))

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

observed_states <- character()
results <- list()
for (fixture in payload$fixtures) {
  id <- fixture$id
  result <- audit_design_graph(
    normalize_design(fixture$design),
    unlist(fixture$validated_ids, use.names = FALSE)
  )
  results[[id]] <- result
  observed_states <- c(observed_states, result$state)
  if (!identical(result$state, fixture$expected_state)) {
    stop(sprintf(
      "%s: state %s, expected %s",
      id, result$state, fixture$expected_state
    ))
  }
  expected_codes <- unlist(fixture$expected_codes, use.names = FALSE)
  missing_codes <- setdiff(expected_codes, result$issues$code)
  if (length(missing_codes)) {
    stop(sprintf("%s: missing reason code(s): %s", id, paste(missing_codes, collapse = ", ")))
  }
  expected_can_compute <- result$state %in% c(
    "Estimable but fragile", "Within validated envelope"
  )
  stopifnot(identical(result$can_compute, expected_can_compute))
}

stopifnot(setequal(observed_states, DESIGN_AUDIT_STATES))

validated_result <- results[["hierarchical_crossed_validated"]]
for (facet in c("prefecture", "school", "class", "participant", "item")) {
  stopifnot(sprintf("diag(1 + condition_c | %s)", facet) %in%
              validated_result$random_effect_terms)
}

omitted_result <- results[["omitted_item_slope"]]
stopifnot("item" %in% omitted_result$claim_boundary$does_not_generalize_over)
stopifnot(!("item" %in% omitted_result$claim_boundary$generalizes_over))

# Cross-runtime contract: compare all decision-bearing R fields with the
# browser/Cloudflare JavaScript implementation on the same JSON fixtures.
node_output <- system2(
  "node",
  c(file.path(this_dir, "test_design_audit.js"), "--json"),
  stdout = TRUE,
  stderr = TRUE
)
node_status <- attr(node_output, "status")
if (!is.null(node_status) && node_status != 0L) {
  stop("JavaScript parity runner failed:\n", paste(node_output, collapse = "\n"))
}
js_results <- jsonlite::fromJSON(paste(node_output, collapse = "\n"), simplifyVector = FALSE)
js_by_id <- stats::setNames(js_results, vapply(js_results, `[[`, character(1), "id"))

issue_signatures_r <- function(issue_frame) {
  sort(paste(issue_frame$code, issue_frame$severity, issue_frame$facet, sep = "|"))
}
issue_signatures_js <- function(issue_list) {
  sort(vapply(issue_list, function(issue) {
    paste(issue$code, issue$severity, issue$facet, sep = "|")
  }, character(1)))
}

for (id in names(results)) {
  r_result <- results[[id]]
  js_result <- js_by_id[[id]]
  stopifnot(
    identical(r_result$state, js_result$state),
    identical(r_result$can_compute, js_result$can_compute),
    identical(issue_signatures_r(r_result$issues), issue_signatures_js(js_result$issues)),
    setequal(r_result$random_effect_terms, unlist(js_result$random_effect_terms, use.names = FALSE)),
    identical(r_result$formula_suggestion, js_result$formula_suggestion),
    setequal(
      r_result$claim_boundary$generalizes_over,
      unlist(js_result$claim_boundary$generalizes_over, use.names = FALSE)
    ),
    setequal(
      r_result$claim_boundary$does_not_generalize_over,
      unlist(js_result$claim_boundary$does_not_generalize_over, use.names = FALSE)
    )
  )
}

cat(sprintf(
  "R/JavaScript design-audit parity: %d shared fixtures OK\n",
  length(payload$fixtures)
))
