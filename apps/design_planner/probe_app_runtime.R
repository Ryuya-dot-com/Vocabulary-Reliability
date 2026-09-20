#!/usr/bin/env Rscript

# Source/bootstrap diagnostic for the local Shiny companion. This probe does
# not start a browser, bind a port, contact a network service, or write a file.
# Its measurements are machine-specific observations, not release thresholds.

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("probe_app_runtime.R requires jsonlite.")
}
if (!requireNamespace("shiny", quietly = TRUE) || !requireNamespace("ggplot2", quietly = TRUE)) {
  stop("probe_app_runtime.R requires the app runtime packages shiny and ggplot2.")
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args)) stop("probe_app_runtime.R does not accept arguments.")

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
this_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[1])))
app_path <- file.path(this_dir, "app.R")

invisible(gc(reset = TRUE))
gc_before <- sum(gc()[, "used"])
app_env <- new.env(parent = globalenv())
timing <- system.time(sys.source(app_path, envir = app_env))
gc_after <- sum(gc()[, "used"])

required_objects <- c("ui", "server")
missing_objects <- required_objects[!vapply(required_objects, exists, logical(1), envir = app_env, inherits = FALSE)]
if (length(missing_objects)) {
  stop("App bootstrap did not create required object(s): ", paste(missing_objects, collapse = ", "))
}
if (!is.function(app_env$server)) stop("App server object is not a function.")

core_functions <- ls(app_env, all.names = TRUE)
core_functions <- core_functions[vapply(core_functions, function(name) {
  is.function(get(name, envir = app_env, inherits = FALSE))
}, logical(1))]

result <- list(
  probe_version = "1.0.0",
  interpretation = "source/bootstrap proxy only; not an HTTP cold-start or concurrency benchmark",
  elapsed_seconds = unname(timing[["elapsed"]]),
  user_seconds = unname(timing[["user.self"]]),
  system_seconds = unname(timing[["sys.self"]]),
  gc_used_cell_delta = unname(gc_after - gc_before),
  ui_object_bytes = as.numeric(object.size(app_env$ui)),
  server_object_bytes = as.numeric(object.size(app_env$server)),
  function_count_in_app_environment = length(core_functions),
  versions = list(
    R = paste(R.version$major, R.version$minor, sep = "."),
    shiny = as.character(utils::packageVersion("shiny")),
    ggplot2 = as.character(utils::packageVersion("ggplot2"))
  ),
  network_contacted = FALSE,
  port_bound = FALSE,
  file_written = FALSE,
  threshold_enforced = FALSE
)

cat(jsonlite::toJSON(result, auto_unbox = TRUE, digits = 16), "\n", sep = "")
