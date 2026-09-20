#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
this_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[1])))
source(file.path(this_dir, "planner_functions.R"))

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("test_claim_math.R requires jsonlite to read the shared fixtures.")
}

payload <- jsonlite::fromJSON(
  file.path(this_dir, "data", "claim_math_fixtures.json"),
  simplifyVector = FALSE
)
stopifnot(identical(payload$schema_version, "1.0.0"))

for (fixture in payload$alpha_expectation) {
  input <- fixture$inputs
  result <- alpha_expectation_flags(
    as.numeric(input$k), as.numeric(input$r_bar), as.numeric(input$p_bar),
    isTRUE(input$high_load)
  )
  stopifnot(
    isTRUE(all.equal(result$expected_alpha, as.numeric(fixture$expected$alpha), tolerance = 1e-12)),
    identical(result$floor_ceiling_flag, fixture$expected$floor_ceiling_flag),
    identical(result$memory_sorting_flag, fixture$expected$memory_sorting_flag)
  )
}

for (fixture in payload$effect_projection) {
  input <- fixture$inputs
  sampling_sd <- effect_sampling_sd(
    as.numeric(input$n_person), as.numeric(input$k_per_condition),
    as.numeric(input$person_slope_sd), as.numeric(input$item_slope_sd),
    as.numeric(input$memory_moderation), isTRUE(input$memory_adjusted)
  )
  bottleneck <- effect_bottleneck(
    as.numeric(input$n_person), as.numeric(input$k_per_condition),
    as.numeric(input$person_slope_sd), as.numeric(input$item_slope_sd),
    as.numeric(input$memory_moderation), isTRUE(input$memory_adjusted)
  )
  stopifnot(
    isTRUE(all.equal(sampling_sd, as.numeric(fixture$expected$sampling_sd), tolerance = 1e-12)),
    identical(bottleneck, fixture$expected$bottleneck)
  )
}

stopifnot(
  inherits(try(effect_sampling_sd(120, 15, 1e-200, .2), silent = TRUE), "try-error"),
  inherits(try(effect_bottleneck(120, 15, 1e-200, .2), silent = TRUE), "try-error"),
  inherits(try(effect_sampling_sd(120, 15, 1e308, .2), silent = TRUE), "try-error"),
  isTRUE(all.equal(effect_sampling_sd(120, 15, .2, .2, 1e308, TRUE),
                   sqrt(.2^2 / 120 + .2^2 / 30), tolerance = 1e-12))
)

node_output <- system2(
  "node",
  c(file.path(this_dir, "test_claim_math.js"), "--json"),
  stdout = TRUE,
  stderr = TRUE
)
node_status <- attr(node_output, "status")
if (!is.null(node_status) && node_status != 0L) {
  stop("JavaScript claim-math parity runner failed:\n", paste(node_output, collapse = "\n"))
}
js <- jsonlite::fromJSON(paste(node_output, collapse = "\n"), simplifyVector = FALSE)
for (index in seq_along(payload$alpha_expectation)) {
  expected <- as.numeric(payload$alpha_expectation[[index]]$expected$alpha)
  stopifnot(isTRUE(all.equal(as.numeric(js$alpha_expectation[[index]]$alpha), expected, tolerance = 1e-12)))
}
for (index in seq_along(payload$effect_projection)) {
  expected <- as.numeric(payload$effect_projection[[index]]$expected$sampling_sd)
  stopifnot(isTRUE(all.equal(as.numeric(js$effect_projection[[index]]$sampling_sd), expected, tolerance = 1e-12)))
}

cat(sprintf(
  "R/JavaScript claim-math parity: %d shared fixtures OK\n",
  length(payload$alpha_expectation) + length(payload$effect_projection)
))
