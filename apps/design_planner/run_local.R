#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
if (length(file_arg) == 1) {
  app_dir <- dirname(normalizePath(sub("^--file=", "", file_arg), mustWork = TRUE))
} else if (file.exists("app.R") && file.exists("planner_functions.R")) {
  app_dir <- normalizePath(".", mustWork = TRUE)
} else {
  app_dir <- normalizePath("apps/design_planner", mustWork = TRUE)
}

needed <- c("shiny", "ggplot2")
missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) {
  stop(
    "Missing package(s): ", paste(missing, collapse = ", "),
    "\nInstall with: install.packages(c(",
    paste(sprintf('"%s"', missing), collapse = ", "),
    "))",
    call. = FALSE
  )
}

port_env <- Sys.getenv("DESIGN_PLANNER_PORT", unset = "")
if (nzchar(port_env)) {
  options(shiny.port = as.integer(port_env))
}

message("Launching Design Planner from: ", app_dir)
message("Local-only Shiny host: 127.0.0.1")
shiny::runApp(app_dir, host = "127.0.0.1", launch.browser = interactive())
