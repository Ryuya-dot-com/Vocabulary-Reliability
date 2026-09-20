#!/usr/bin/env Rscript
# app.R -- Design Planner (Supplementary Material companion app)
#
# Thin UI/server layer only. All computation lives in planner_functions.R
# (pure, unit-tested functions -- see test_planner_functions.R). Uses shiny
# and ggplot2 only; no other packages.
#
# Anonymous: no author information appears anywhere in this app.

suppressPackageStartupMessages({
  library(shiny)
  library(ggplot2)
})

.app_dir <- local({
  # 1. shiny::runApp() always sets the working directory to the app's own
  #    directory before evaluating app.R, so this covers every real launch.
  if (file.exists("planner_functions.R")) return(normalizePath("."))
  # 2. source()/sys.source()'d from elsewhere (e.g. a test harness): find the
  #    frame that has this file as its `ofile`.
  for (fr in rev(sys.frames())) {
    ofile <- fr$ofile
    if (!is.null(ofile) && file.exists(ofile) &&
        file.exists(file.path(dirname(normalizePath(ofile)), "planner_functions.R"))) {
      return(dirname(normalizePath(ofile)))
    }
  }
  # 3. `Rscript app.R` run directly.
  ca <- commandArgs(trailingOnly = FALSE)
  fa <- grep("^--file=", ca, value = TRUE)
  if (length(fa) == 1) return(dirname(normalizePath(sub("^--file=", "", fa[1]))))
  getwd()
})
source(file.path(.app_dir, "planner_functions.R"))

footer_note <- div(
  style = "margin-top: 2.5em; padding-top: 1em; border-top: 1px solid #ccc; color: #666; font-size: 0.85em;",
  "Companion to the manuscript; see Supplementary Table S1 for full simulation specifications."
)

approx_disclaimer <- div(
  style = "margin: 0.75em 0; padding: 0.6em 0.8em; background: #fff6e5; border-left: 4px solid #e0a800; font-size: 0.9em;",
  strong("This is an approximation / a published-simulation grid, not a new simulation of your exact design. "),
  "For a custom sensitivity analysis of your own design, generate and run the self-contained script in Tab 5; simulation does not provide an exact answer or certify the design."
)

## Small helper generalizing approx_disclaimer's box styling for a one-sentence
## "Start here" routing note, repeated (with different text) at the top of
## every tab.
start_here_note <- function(...) {
  div(
    style = "margin: 0.75em 0; padding: 0.6em 0.8em; background: #eef4fb; border-left: 4px solid #2c5f8a; font-size: 0.9em;",
    strong("Start here: "), ...
  )
}

## One-sentence "what this number does NOT license" footer, rendered directly
## under each tab's main output block (estimand-alignment discipline: each
## displayed value answers one of Figure 1's inferential branches).
does_not_license_note <- function(...) {
  div(style = "margin: 0.4em 0 0.75em 0; color: #555; font-size: 0.85em; font-style: italic;", ...)
}

## Progressive-disclosure helper for longer explanatory material. Keeps the
## main workflow readable while preserving full provenance/help text.
details_panel <- function(summary_text, ...) {
  tags$details(
    style = "margin: 1em 0; padding: 0.7em 0.9em; border: 1px solid #ddd; background: #fafafa;",
    tags$summary(
      style = "cursor: pointer; font-weight: bold;",
      summary_text
    ),
    div(style = "margin-top: 0.75em;", ...)
  )
}

## Always-visible scope statement (same box on every tab, mirroring how
## footer_note is repeated identically on every tab below).
scope_note <- div(
  style = "margin: 0 0 0.75em 0; padding: 0.6em 0.8em; background: #f0f0f0; border-left: 4px solid #666; font-size: 0.85em;",
  strong("Scope: "),
  "Planning and diagnostic aid, not a certification tool. No data upload or storage. Use Help for missing reports, defaults, and workflow guidance."
)

sim19_scenarios <- c(
  "Balanced lists, moderate context effect" = "balanced_moderate",
  "Imperfect counterbalance with item-feature skew" = "imperfect_counterbalance",
  "Context mainly creates partial knowledge" = "partial_only_effect",
  "True null calibration (no context advantage)" = "true_null_balanced",
  "Weak effect with aptitude-linked delayed attrition" = "weak_moderated_missing"
)
sim19_scoring <- c("Strict full recall", "Lenient any knowledge", "Partial credit")

sim07_scenarios <- c(
  "High alpha, stable effect" = "alpha_high_effect_stable",
  "High alpha, item-sensitive effect" = "alpha_high_item_sensitive",
  "High alpha, person-sensitive effect" = "alpha_high_person_sensitive",
  "Low-alpha recognition, stable effect" = "recognition_alpha_low_effect_stable",
  "High load, memory-moderated effect" = "high_load_memory_moderated"
)

ui <- navbarPage(
  title = "Design Planner",
  id = "main_nav",

  tabPanel(
    "1. Alpha expectations",
    fluidPage(
      scope_note,
      p(em("Corresponds to Figure 1's person-level-score branch and Table 2's design-conditional alpha references.")),
      start_here_note("Type in your item count and, if you know it, your expected average item difficulty; if you don't know your average inter-item correlation, see the helper text below the r̄ slider."),
      sidebarLayout(
        sidebarPanel(
          numericInput("t1_k", "Number of items (k)", value = 15, min = 2, max = 100, step = 1),
          sliderInput("t1_rbar", "Average inter-item correlation (r̄)", min = 0.05, max = 0.40, value = 0.15, step = 0.01),
          helpText("The .10, .15, and .22 reference values are illustrative assumptions from Table 2, not an established typical range. Compare several plausible values. For raw alpha/KR-20, use mean covariance divided by mean item variance; the mean Pearson correlation instead gives standardized alpha (Supplement S5.5)."),
          sliderInput("t1_pbar", "Expected mean proportion correct (p̄)", min = 0, max = 1, value = 0.55, step = 0.01),
          checkboxInput("t1_highload", "High cognitive-load design (e.g., many words under short/massed exposure)", value = FALSE),
          helpText("Formula: expected alpha = k·r̄ / (1 + (k-1)·r̄), the classical relation between item count and average inter-item correlation used in manuscript Table 2.")
        ),
        mainPanel(
          h3(textOutput("t1_alpha_display")),
          uiOutput("t1_flags"),
          does_not_license_note(
            "This expected value answers score reliability only: it is not evidence that a condition effect exists, that word-to-condition assignment was unconfounded, or that an effect would replicate with a different sample of words."
          ),
          hr(),
          h4("How expected reliability changes as you add items"),
          plotOutput("t1_alpha_curve_plot", height = "360px"),
          hr(),
          h4("Reference: manuscript Table 2 theoretical rows"),
          tableOutput("t1_reference_table")
        )
      ),
      footer_note
    )
  ),

  tabPanel(
    "2. Effect generalizability",
    fluidPage(
      scope_note,
      p(em("Corresponds to Figure 1's generalization-beyond-sampled-words-and-learners branch.")),
      start_here_note("If you're not sure which numbers to type for the heterogeneity inputs below, pick a published scenario from the dropdown first -- it fills in the harder ones for you."),
      sidebarLayout(
        sidebarPanel(
          ## FIX (found during Phase 0 verification): the previous choices
          ## vector mapped label -> label via setNames(names(sim07_scenarios),
          ## names(sim07_scenarios)), so input$t2_preset held the display
          ## label (e.g. "High alpha, stable effect") instead of the scenario
          ## code, and the observeEvent below's `specs$scenario ==
          ## input$t2_preset` lookup never matched any row (0 rows every
          ## time) -- the dropdown silently did nothing when a scenario was
          ## selected. Now mirrors the (correct) t3_07_scenario/t4_preset
          ## pattern: choices are built directly from sim07_scenarios
          ## (label -> code).
          selectInput("t2_preset", "Load a named scenario (from sim_07)",
                      choices = c("Custom" = "custom", sim07_scenarios)),
          numericInput("t2_n", "Participants (N)", value = 120, min = 10, max = 2000, step = 10),
          numericInput("t2_k", "Items per condition (k) (e.g., 15 if 30 target words are split across 2 lists)", value = 30, min = 5, max = 100, step = 1),
          numericInput("t2_person_slope_sd", "Person-slope SD (heterogeneity across learners)", value = 0.05, min = 0, max = 2, step = 0.01),
          numericInput("t2_item_slope_sd", "Item-slope SD (item-by-condition slope SD; heterogeneity across words)", value = 0.65, min = 0, max = 2, step = 0.01),
          helpText("Don't know these values? They are hard to guess directly -- use the preset dropdown above to load them from a published scenario instead of typing your own guess."),
          numericInput("t2_memory_mod", "Memory-moderation coefficient (0 if none)", value = 0, min = 0, max = 2, step = 0.01),
          checkboxInput("t2_memory_adjusted", "Model memory as an explicit moderator (condition × memory)", value = FALSE),
          helpText("Formula extracted verbatim from scripts/run_effect_generalizability_simulations.R (effect_sampling_sd_unmodeled / _memory_adjusted).")
        ),
        mainPanel(
          h3(textOutput("t2_sd_display")),
          h4(textOutput("t2_bottleneck_display")),
          does_not_license_note(
            "This is a projection from the typed-in person/item-slope SDs, not a fitted model on real data: it does not confirm these SDs are the true values for your design, and it is not itself a report of effect generalizability."
          ),
          plotOutput("t2_curve_plot", height = "420px")
        )
      ),
      footer_note
    )
  ),

  tabPanel(
    title = tags$span("3. GLMM detection & risks",
                       title = "GLMM: generalized linear mixed model -- the statistical model fit in the underlying simulations to estimate and test the condition effect while accounting for both participants and items."),
    value = "3. GLMM detection & risks",
    fluidPage(
      scope_note,
      p(em("Corresponds to Figure 1's condition-effect branch, with design-diagnostic notes for singular/boundary fits.")),
      start_here_note("If your design is roughly 24-60 within-subject learners with counterbalanced word lists, the default \"Small ecological classroom\" family below is already close to your design."),
      approx_disclaimer,
      sidebarLayout(
        sidebarPanel(
          actionButton("t3_preset_typical", "My study looks like this (typical MA classroom study: ~40 learners, 30 words on two counterbalanced lists)"),
          helpText("Fills in the design family, scenario, scoring, and N below for a typical small within-subject classroom study."),
          hr(),
          radioButtons("t3_family", "Design family (precomputed grid)",
                       choices = c(
                         "Small ecological classroom (N = 24 or 60; sim_19)" = "sim19",
                         "Larger crossed design (N = 120 or 300, k = 15 or 30; sim_07)" = "sim07"
                       )),
          conditionalPanel(
            condition = "input.t3_family == 'sim19'",
            selectInput("t3_19_scenario", "Scenario", choices = sim19_scenarios),
            selectInput("t3_19_scoring", "Scoring method", choices = sim19_scoring),
            sliderInput("t3_19_n", "Participants (N) -- observed at 24 and 60; interpolated between", min = 24, max = 60, value = 24, step = 1),
            helpText("Fixed design: 30 target words on two counterbalanced lists (15 items/condition), as simulated in sim_19.")
          ),
          conditionalPanel(
            condition = "input.t3_family == 'sim07'",
            selectInput("t3_07_scenario", "Scenario", choices = sim07_scenarios),
            selectInput("t3_07_n", "Participants (N)", choices = c(120, 300)),
            selectInput("t3_07_k", "Items per condition (k) (e.g., 15 if 30 target words are split across 2 lists)", choices = c(15, 30)),
            selectInput("t3_07_model", "Model",
                        choices = c("Condition only" = "base_condition", "Condition × memory" = "condition_by_memory"))
          )
        ),
        mainPanel(
          h3(textOutput("t3_power_display")),
          uiOutput("t3_mode_note"),
          uiOutput("t3_singular_note"),
          does_not_license_note(
            "The small-classroom grid is observed only at N = 24 and 60; intermediate values are interpolations whose accuracy has not been independently validated. The larger-design grid uses exact rows only. Neither is a guarantee for your sample, and a high rate cannot rule out confounded assignment."
          ),
          details_panel(
            "Show calibration details",
            p("The Wald Phi-transform of a published beta/SE is accurate (max |error| = 3.1 percentage points across 30 sim_19 points), so it is used here only to interpolate between two real grid points -- never to compute power from user-typed design parameters with no matching published fit. A naive first-principles SE formula (ignoring participant/item clustering) was tested and failed on 18 of 30 sim_19 points (errors up to ~92 percentage points), which is why this tab shows grid values rather than a free-form calculator."),
            tableOutput("t3_calibration_table")
          )
        )
      ),
      footer_note
    )
  ),

  tabPanel(
    "4. Reliability decision aid",
    fluidPage(
      scope_note,
      p(em("Cautious Bayesian-style interpretation: entered values update confidence in specific claims, but the app does not compute posterior probabilities or certify a design.")),
      start_here_note("Choose the claim the study makes, then enter the coefficient and design facts that a reviewer would see in the report."),
      sidebarLayout(
        sidebarPanel(
          selectInput(
            "t5_claim", "Primary claim",
            choices = c(
              "Condition effect / intervention worked" = "condition_effect",
              "Person-level score interpretation" = "person_score",
              "Delayed retention" = "delayed_retention",
              "Generalization beyond sampled words" = "generalize_words",
              "Construct or scoring-rule interpretation" = "construct_scoring"
            )
          ),
          selectInput(
            "t5_analysis_model", "Analysis model for effect claim",
            choices = c(
              "Not reported / unclear" = "unclear",
              "Participant-level ANOVA/t-test on score means" = "aggregate_anova",
              "Separate participant and item analyses" = "subject_item_anova",
              "Crossed GLMM/IRT, item resampling, or D-study evidence" = "crossed_or_resampling"
            ),
            selected = "unclear"
          ),
          selectInput(
            "t5_descriptive_status", "Descriptive outcome reporting",
            choices = c(
              "Not reported / unclear" = "unclear",
              "Raw accuracy / proportion correct only" = "raw_accuracy",
              "Participant score M/SD/95% CI" = "participant_descriptives",
              "Model-estimated probabilities with 95% CI" = "model_estimated",
              "Both raw accuracy and model-estimated probabilities" = "raw_and_model"
            ),
            selected = "unclear"
          ),
          radioButtons(
            "t5_coeff_status", "Coefficient status",
            choices = c(
              "Reported" = "reported",
              "Not computable (e.g., all-zero pretest or all-correct posttest)" = "not_computable",
              "Not reported" = "not_reported"
            ),
            selected = "reported"
          ),
          conditionalPanel(
            condition = "input.t5_coeff_status == 'reported'",
            numericInput("t5_alpha", "Reported alpha/KR-20", value = 0.75, min = -1, max = 1, step = 0.01)
          ),
          numericInput("t5_k", "Items in the reported score", value = 15, min = 2, max = 100, step = 1),
          sliderInput("t5_pbar", "Mean proportion correct", min = 0, max = 1, value = 0.55, step = 0.01),
          selectInput(
            "t5_denominator_policy", "Pretest-known items / denominator",
            choices = c(
              "Not reported / unclear" = "unclear",
              "Fixed condition denominator retained (e.g., 15 items)" = "fixed_denominator",
              "Pretest-known items excluded; denominator varies" = "unknown_only_variable",
              "Pretest-known status modeled or adjusted" = "pretest_adjusted"
            ),
            selected = "unclear"
          ),
          hr(),
          selectInput(
            "t5_counterbalance_status", "Word-condition assignment",
            choices = c(
              "Reported counterbalanced" = "yes",
              "Reported fixed / not counterbalanced" = "no",
              "Not reported / unclear" = "unclear"
            ),
            selected = "unclear"
          ),
          selectInput(
            "t5_baseline_status", "Baseline balance or adjustment",
            choices = c(
              "Reported checked or modeled" = "yes",
              "Reported not checked / not modeled" = "no",
              "Not reported / unclear" = "unclear"
            ),
            selected = "unclear"
          ),
          selectInput(
            "t5_repeated_status", "Same target words repeatedly tested",
            choices = c(
              "Reported yes" = "yes",
              "Reported no" = "no",
              "Not reported / unclear" = "unclear"
            ),
            selected = "unclear"
          ),
          selectInput(
            "t5_control_design", "Repeated-testing control evidence",
            choices = c(
              "None / not reported / unclear" = "none",
              "No-test control" = "no_test",
              "Delayed-only control" = "delayed_only",
              "Parallel form" = "parallel_form",
              "Control items" = "control_items",
              "Test-only group" = "test_only"
            )
          ),
          selectInput(
            "t5_scoring_rule", "Scoring / response format",
            choices = c(
              "Strict full recall" = "strict",
              "Lenient any knowledge" = "lenient",
              "Partial credit" = "partial",
              "Recognition" = "recognition",
              "Mixed battery / composite" = "mixed"
            )
          ),
          checkboxInput("t5_hand_scored", "Hand-scored responses", value = FALSE),
          checkboxInput("t5_high_load", "High cognitive-load design", value = FALSE),
          downloadButton("t5_download_decision", "Download decision table")
        ),
        mainPanel(
          h3("Diagnostic update"),
          p(textOutput("t5_overall")),
          p(textOutput("t5_rbar")),
          tableOutput("t5_decision_table"),
          does_not_license_note(
            "This table is a routing aid. It tells authors and reviewers which interpretation becomes more or less plausible given the entered evidence; it is not a pass/fail reliability score."
          )
        )
      ),
      footer_note
    )
  ),

  tabPanel(
    "5. Generate my simulation script",
    fluidPage(
      scope_note,
      p(em("Spans Figure 1's condition-effect and generalization branches via a self-contained simulation of your own design.")),
      start_here_note("Use this tab for a custom sensitivity analysis of your own design, not an exact answer or design certificate; if you just want a ballpark first, Tabs 1-3 answer common planning questions from published grids without requiring you to run anything."),
      sidebarLayout(
        sidebarPanel(
          # Same five named scenarios as effect_scenario_specs.csv (identical
          # codes/labels to sim07_scenarios above), reused here as presets for
          # delta / person_slope_sd / item_slope_sd -- see the observeEvent
          # below, mirroring Tab 2's preset pattern.
          selectInput("t4_preset", "Copy three effect parameters from a published scenario",
                      choices = c("(choose a published scenario)" = "custom", sim07_scenarios)),
          numericInput("t4_n", "Participants (N)", value = 60, min = 4, max = 5000, step = 1),
          numericInput("t4_k", "Items per condition (k) (e.g., 15 if 30 target words are split across 2 lists)", value = 15, min = 2, max = 200, step = 1),
          numericInput("t4_delta", "True condition effect (logit scale)", value = 0.5, step = 0.05),
          numericInput("t4_person_slope_sd", "Person-slope SD (heterogeneity across learners)", value = 0.1, min = 0, step = 0.01),
          numericInput("t4_item_slope_sd", "Item-slope SD (heterogeneity across words)", value = 0.1, min = 0, step = 0.01),
          helpText("Don't know delta, person-slope SD, or item-slope SD? Use the preset dropdown above to load values from a published scenario. Note: delta is on the logit scale (not Cohen's d); published scenarios use delta = .55-.75."),
          helpText("Only these three values are copied. Baseline accuracy, intercept variation, guessing, scoring, and memory moderation are not copied. The generated script does not reproduce the full named scenario."),
          selectInput("t4_scoring", "Scoring method", choices = c("Strict full recall" = "strict", "Lenient any knowledge (20% lower-asymptote stress test)" = "lenient", "Partial credit (0/1/2 binomial trials)" = "partial")),
          numericInput("t4_nrep", "Monte Carlo replications", value = 500, min = 10, max = 5000, step = 10),
          numericInput("t4_seed", "Random seed", value = 20260628, step = 1),
          actionButton("t4_copy", "Copy script to clipboard"),
          downloadButton("t4_download", "Download .R file")
        ),
        mainPanel(
          helpText("This script is self-contained and can be run with Rscript. It requires lme4 2.0-6 or newer, uses a centered numeric condition contrast, explicit diagonal participant/item random-slope structures, Laplace approximation (nAGQ = 1), one simulated dataset per replication, and an MCSE-annotated summary table. The lenient option is explicitly labeled as a lower-asymptote model-mismatch stress test."),
          details_panel(
            "Show generated script",
            verbatimTextOutput("t4_script_out")
          )
        )
      ),
      footer_note
    )
  ),

  tabPanel(
    "Help",
    fluidPage(
      scope_note,
      h3("Start with one question"),
      p("If the app feels dense, choose the row that matches your immediate task. Open the longer sections only when you need them."),
      p("The companion app is designed for local use from the downloaded review package or repository. It does not upload data, store inputs, or require user data files."),
      tags$table(
        class = "table table-condensed table-striped",
        tags$thead(
          tags$tr(
            tags$th("Question"),
            tags$th("Use"),
            tags$th("Stop when")
          )
        ),
        tags$tbody(
          tags$tr(
            tags$td("Will my planned design answer the claim?"),
            tags$td("Tabs 1-3; Tab 5 only if your design needs its own simulation."),
            tags$td("You know the planned score unit, item count, assignment design, scoring rule, and control evidence.")
          ),
          tags$tr(
            tags$td("What should I ask an author to report?"),
            tags$td("Tab 4, with missing facts marked Not reported / unclear."),
            tags$td("You can name the missing evidence, not just ask for alpha.")
          ),
          tags$tr(
            tags$td("What can I honestly claim after collecting data?"),
            tags$td("Tab 4 first; Tabs 1-3 or Tab 5 only for sensitivity context."),
            tags$td("Unsupported claims are narrowed or moved to limitations.")
          )
        )
      ),
      details_panel(
        "Show local-use and privacy notes",
        tags$table(
        class = "table table-condensed table-striped",
        tags$thead(
          tags$tr(
            tags$th("Issue"),
            tags$th("Practical implication")
          )
        ),
        tags$tbody(
          tags$tr(
            tags$td("Local launch"),
            tags$td("Run the app from the downloaded repository or review package with Rscript apps/design_planner/run_local.R, or with shiny::runApp(\"apps/design_planner\"). The browser address is a local Shiny session, not a public web service.")
          ),
          tags$tr(
            tags$td("Packages"),
            tags$td("The interactive app itself uses only shiny and ggplot2. Tab 5's downloaded simulation script is separate and requires the manuscript analysis packages listed in the README.")
          ),
          tags$tr(
            tags$td("Bundled data"),
            tags$td("Displayed grid values come from CSV snapshots bundled with the app. They are checked against the manuscript simulation summaries by the validation script.")
          ),
          tags$tr(
            tags$td("User inputs"),
            tags$td("The app computes from typed values and menu choices. It has no upload field and does not write a record of inputs unless the user downloads a decision table or generated script.")
          ),
          tags$tr(
            tags$td("Offline use"),
            tags$td("After required R packages are installed, the app can be used without internet access. External repositories are provenance for the manuscript, not runtime services for the app.")
          )
        )
        )
      ),
      details_panel(
        "Show common workflows",
        tags$table(
        class = "table table-condensed table-striped",
        tags$thead(
          tags$tr(
            tags$th("Role"),
            tags$th("Start with"),
            tags$th("Practical decision"),
            tags$th("Guardrail")
          )
        ),
        tags$tbody(
          tags$tr(
            tags$td("Planning a new experiment"),
            tags$td("Tabs 1-3, then Tab 5 if the design departs from the published grids."),
            tags$td("Choose item count, counterbalancing, scoring rule, delayed-test controls, and whether more learners or more words are the limiting resource."),
            tags$td("Treat presets and defaults as planning scenarios. Do not report them later as if they were observed values.")
          ),
          tags$tr(
            tags$td("Reviewing a submitted paper"),
            tags$td("Tab 4, then this source map."),
            tags$td("Translate a broad reliability request into specific missing evidence: score reliability, assignment design, repeated-testing control, scoring-rule rationale, or effect generalizability."),
            tags$td("Use Not reported / unclear rather than filling gaps. Tabs 1-3 can illustrate why a missing report matters, but they do not prove the submitted design's value.")
          ),
          tags$tr(
            tags$td("Preparing a manuscript after data collection"),
            tags$td("Tab 4 for claim alignment, Tabs 1-3 for sensitivity context, Tab 5 for a design-specific simulation if needed."),
            tags$td("Decide which claims can be supported, which diagnostics to report, and which limitations must be stated because the design cannot be changed after data collection."),
            tags$td("Do not use post-hoc simulations to certify a weak design. Use them to quantify sensitivity and to narrow claims.")
          )
        )
        )
      ),
      details_panel(
        "Show where to find inputs in a paper",
        p("Do not infer an unreported design fact from a default value in the app; mark it as not reported / unclear."),
        tags$table(
        class = "table table-condensed table-striped",
        tags$thead(
          tags$tr(
            tags$th("App input"),
            tags$th("Where to look in the paper"),
            tags$th("If it is missing")
          )
        ),
        tags$tbody(
          tags$tr(
            tags$td("alpha/KR-20 and k"),
            tags$td("Reliability, measures, scoring, or descriptive-statistics section; check whether it is condition-specific, time-specific, or pooled."),
            tags$td("Use Not reported. Do not substitute a similar coefficient from another score.")
          ),
          tags$tr(
            tags$td("Mean proportion correct"),
            tags$td("Descriptive statistics, item-level summaries, or score-distribution tables."),
            tags$td("Keep the default only for sensitivity exploration; do not treat it as reported evidence.")
          ),
          tags$tr(
            tags$td("Counterbalancing / word-condition assignment"),
            tags$td("Design, materials, randomization, or procedure section; look for list rotation, Latin-square assignment, or fixed-list assignment."),
            tags$td("Select Not reported / unclear. Alpha cannot repair an unreported assignment design.")
          ),
          tags$tr(
            tags$td("Analysis model for effect claim"),
            tags$td("Results or statistical-analysis section; check whether the paper used participant-level ANOVA/t-test on aggregate scores, separate participant/item analyses, or a crossed item-by-participant model/resampling approach."),
            tags$td("If ANOVA was used, do not treat it as automatically wrong. Ask whether the claim is limited to sampled score means or extends to words/items beyond the sample.")
          ),
          tags$tr(
            tags$td("Descriptive outcome reporting"),
            tags$td("Descriptive-statistics table, GLMM results table, or figure captions; check whether the paper reports raw accuracy/proportion correct, participant-level M/SD/95% CI, model-estimated probabilities, or both."),
            tags$td("Accuracy rates are useful response-scale descriptives, but they do not replace the GLMM coefficient, uncertainty, random-effects/item treatment, or reliability evidence.")
          ),
          tags$tr(
            tags$td("Pretest-known items / denominator"),
            tags$td("Measures, scoring, exclusion, and analysis sections; check whether pretest-correct items were retained, excluded participant-by-participant, or modeled as prior knowledge."),
            tags$td("With a fixed 15-item condition score, M = 6/15 and .40 are equivalent. If pretest-known items are excluded, denominators can become 13/15, 14/15, etc.; report the eligible denominator and do not compare raw counts as if all scores had the same maximum.")
          ),
          tags$tr(
            tags$td("Baseline balance or adjustment"),
            tags$td("Participant characteristics, pretest equivalence, covariates, or model specification."),
            tags$td("Select Not reported / unclear unless balance was checked, modeled, or design-guaranteed.")
          ),
          tags$tr(
            tags$td("Repeated same-item testing and controls"),
            tags$td("Procedure, test schedule, delayed posttest, appendix instruments, and whether no-test, test-only, delayed-only, parallel-form, or control-item evidence is reported."),
            tags$td("For delayed-retention claims, missing information leaves the repeated-testing interpretation unresolved.")
          ),
          tags$tr(
            tags$td("Scoring / response format"),
            tags$td("Scoring rubric, examples, rater/scorer procedure, recognition distractors, partial-credit criteria."),
            tags$td("Use the closest explicit scoring rule; if the paper mixes formats, select mixed battery / composite.")
          ),
          tags$tr(
            tags$td("person-slope SD, item-slope SD, delta"),
            tags$td("Usually not reported directly; may appear in random-effects output, simulation planning, or supplementary model tables."),
            tags$td("Use the published scenario presets or treat Tab 2/Tab 5 as sensitivity analysis, not as reconstruction of the paper.")
          )
        )
        )
      ),
      details_panel(
        "Show common problem cases",
        h4("A paper used ANOVA on condition scores"),
        p("Do not reject the analysis label automatically. First identify the claim. If the claim is limited to the sampled class, sampled words, and reported score means, a participant-level ANOVA may describe that score contrast. If the claim extends to lexical items beyond the sampled word set, the paper also needs item-level evidence, crossed modeling, item resampling, or a clearly narrowed limitation."),
        p("In Tab 4, choose Participant-level ANOVA/t-test on score means unless the paper also reports separate item analyses or crossed item-by-participant evidence. Then code counterbalancing, baseline adjustment, denominator policy, and repeated-testing control as reported, not as assumed."),
        h4("A GLMM paper reports accuracy rates"),
        p("Accuracy or proportion-correct values are useful response-scale descriptives. They show what the observed performance looked like and help readers see floor/ceiling pressure. They do not replace the model formula, logit-scale contrast, uncertainty, participant/item terms, convergence diagnostics, or score-reliability evidence when the claim depends on those quantities."),
        p("In Tab 4, choose Raw accuracy / proportion correct only, Model-estimated probabilities with 95% CI, or Both raw accuracy and model-estimated probabilities according to what is actually reported. Keep observed accuracy and model-estimated probability conceptually separate."),
        h4("A within-subject study used 30 words split into two 15-word conditions"),
        p("For condition descriptives, a fixed-denominator score can be reported as either a count or a proportion because M = 6/15 and .40 convey the same information. The report should still name the denominator so readers know whether the condition score is based on 15 target items, another fixed number, or participant-specific eligible items."),
        p("If pretest-correct items are excluded, the denominator can vary by participant and condition. Then raw counts such as 6 correct are not directly comparable unless the eligible denominator is also reported; use proportions with denominators, or model the participant-item eligibility rule explicitly."),
        h4("An experiment is already finished"),
        p("After data collection, the app should not be used to certify a design that cannot be changed. Use Tab 4 to narrow claims to the evidence actually available, and use Tabs 1-3 or Tab 5 only as sensitivity context for limitations, planned replications, or reviewer-facing clarification."),
        h4("The report is missing several design facts"),
        p("Mark missing facts as Not reported / unclear. Changing defaults can show what would happen under hypothetical assumptions, but it is not evidence about the submitted paper. A useful review request names the missing design fact and the claim it affects.")
      ),
      details_panel(
        "Show how to avoid information overload",
        p("Use one tab for one decision. Do not fill every input just because it is available."),
        tags$table(
        class = "table table-condensed table-striped",
        tags$thead(
          tags$tr(
            tags$th("If you feel stuck"),
            tags$th("Do this"),
            tags$th("Ignore for now")
          )
        ),
        tags$tbody(
          tags$tr(
            tags$td("Planning the design"),
            tags$td("Use Tab 1 for the score unit and item count; use Tab 3 only if the design resembles a published grid; use Tab 5 only when you need a design-specific simulation."),
            tags$td("Do not start by typing hard-to-know random-effect SDs unless you have a reason.")
          ),
          tags$tr(
            tags$td("Reviewing a paper"),
            tags$td("Use Tab 4 and code only the evidence visible in the manuscript, tables, figures, and supplement."),
            tags$td("Do not use planning defaults to fill missing reports.")
          ),
          tags$tr(
            tags$td("Writing after data collection"),
            tags$td("Use Tab 4 to separate supported claims from limitations; then add only the sensitivity checks that answer a concrete reviewer concern."),
            tags$td("Do not add every possible diagnostic if it makes the reporting less interpretable.")
          )
        )
        )
      ),
      details_panel(
        "Show defaults and simulation limits",
        h4("How to interpret defaults"),
        p("Defaults are starting points for sensitivity checks. When evaluating a published study, an unreported value should stay unreported in the decision aid; changing a default shows how the app behaves under a hypothetical design, not what the paper demonstrated."),
        h4("What the app can simulate"),
        p("Tabs 1-3 show closed-form or grid-based trends for planned designs, and Tab 5 generates a new simulation script for a typed design. These trends are useful for planning and sensitivity analysis, but they do not turn missing reporting into evidence.")
      ),
      footer_note
    )
  )
)

server <- function(input, output, session) {

  ## ---- Tab 1 ----
  t1_flags <- reactive({
    validate(need(length(input$t1_k) == 1 && is.finite(input$t1_k) &&
                    input$t1_k >= 2 && input$t1_k <= 100 && input$t1_k == floor(input$t1_k),
                  "Enter a whole number of items from 2 to 100."))
    alpha_expectation_flags(input$t1_k, input$t1_rbar, input$t1_pbar, input$t1_highload)
  })

  output$t1_alpha_display <- renderText({
    a <- t1_flags()$expected_alpha
    sprintf("Expected condition-specific alpha/KR-20 = %.2f  (k = %d, r̄ = %.2f)", a, input$t1_k, input$t1_rbar)
  })

  output$t1_flags <- renderUI({
    f <- t1_flags()
    tagList(
      div(style = if (f$floor_ceiling_flag) "color:#b35900; font-weight:bold;" else "color:#333;",
          f$floor_ceiling_message),
      div(style = if (f$memory_sorting_flag) "color:#b30000; font-weight:bold; margin-top:0.5em;" else "color:#333; margin-top:0.5em;",
          f$memory_sorting_message)
    )
  })

  output$t1_reference_table <- renderTable({
    k_vals <- c(15, 15, 15, 30, 30, 30)
    r_vals <- rep(c(.10, .15, .22), 2)
    data.frame(
      Items = k_vals,
      `Average r` = r_vals,
      `Expected alpha` = pd_round_half_up(expected_alpha(k_vals, r_vals), 2),
      check.names = FALSE
    )
  }, digits = 2)

  ## Alpha-vs-item-count sweep: three reference r̄ curves (the same .10/.15/.22
  ## anchors as the reference table above) plus the user's own r̄ highlighted,
  ## with a vertical reference line at the user's current item count. Observed
  ## points only in the sense that every point on every line is a direct
  ## expected_alpha() evaluation (a closed-form identity, not a simulation
  ## grid), so there is no interpolation/extrapolation caveat needed here.
  output$t1_alpha_curve_plot <- renderPlot({
    t1_flags()
    base_r <- c(.10, .15, .22)
    user_r <- input$t1_rbar
    k_max <- max(60, input$t1_k)

    base_curve <- alpha_curve(base_r, k_max = k_max)
    base_curve$r_label <- factor(sprintf("r̄ = %.2f", base_curve$r_bar))
    user_curve <- alpha_curve(user_r, k_max = k_max)

    ggplot() +
      geom_line(data = base_curve, aes(x = k, y = alpha, color = r_label), linewidth = 0.8) +
      geom_line(data = user_curve, aes(x = k, y = alpha), linewidth = 1.4, color = "black") +
      geom_vline(xintercept = input$t1_k, linetype = 2, color = "grey40") +
      annotate(
        "text", x = input$t1_k, y = 1, label = "current k",
        hjust = -0.05, vjust = 1.2, size = 3.4, color = "grey30"
      ) +
      labs(
        x = "Number of items (k)",
        y = "Expected reliability (alpha)",
        color = "Reference r̄"
      ) +
      theme_bw(base_size = 13)
  })

  ## ---- Tab 2 ----
  observeEvent(input$t2_preset, {
    if (input$t2_preset != "custom") {
      specs <- load_effect_scenario_specs()
      row <- specs[specs$scenario == input$t2_preset, ]
      if (nrow(row) == 1) {
        updateNumericInput(session, "t2_person_slope_sd", value = row$person_slope_sd)
        updateNumericInput(session, "t2_item_slope_sd", value = row$item_slope_sd)
        updateNumericInput(session, "t2_memory_mod", value = row$memory_moderation)
      }
    }
  })

  t2_sd <- reactive({
    effect_sampling_sd(input$t2_n, input$t2_k, input$t2_person_slope_sd,
                        input$t2_item_slope_sd, input$t2_memory_mod, input$t2_memory_adjusted)
  })

  output$t2_sd_display <- renderText({
    value <- t2_sd()
    formatted <- if (value != 0 && (value < 1e-4 || value >= 1e4)) {
      sprintf("%.3e", value)
    } else sprintf("%.4f", value)
    paste("Projected sampling SD of the latent condition effect =", formatted)
  })

  output$t2_bottleneck_display <- renderText({
    b <- effect_bottleneck(input$t2_n, input$t2_k, input$t2_person_slope_sd,
                            input$t2_item_slope_sd, input$t2_memory_mod, input$t2_memory_adjusted)
    paste0("Main bottleneck: ", b,
           " (participants means more N helps most; items means more words help most; both means neither alone suffices)")
  })

  output$t2_curve_plot <- renderPlot({
    curve <- effect_generalizability_curve(input$t2_n, input$t2_person_slope_sd,
                                            input$t2_item_slope_sd, input$t2_memory_mod)
    y_col <- if (input$t2_memory_adjusted) "effect_sampling_sd_memory_adjusted" else "effect_sampling_sd_unmodeled"
    df <- data.frame(k = curve$k_per_condition, sd = curve[[y_col]])
    ggplot(df, aes(x = k, y = sd)) +
      geom_hline(yintercept = c(.10, .20, .30), linetype = 2, color = "grey65") +
      geom_line(linewidth = 0.9, color = "#2c5f8a") +
      geom_point(size = 2.4, color = "#2c5f8a") +
      scale_x_continuous(breaks = c(5, 10, 15, 30, 60, 100)) +
      labs(
        x = "Items per condition", y = "Projected sampling SD"
      ) +
      theme_bw(base_size = 13)
  })

  ## ---- Tab 3 ----
  ## "My study looks like this" preset: mirrors Tab 2's observeEvent preset
  ## pattern above, but fills the Tab 3 design-family controls for a typical
  ## MA classroom study (~40 learners, 30 words on two counterbalanced lists)
  ## instead of loading a CSV row.
  observeEvent(input$t3_preset_typical, {
    updateRadioButtons(session, "t3_family", selected = "sim19")
    updateSelectInput(session, "t3_19_scenario", selected = "balanced_moderate")
    updateSelectInput(session, "t3_19_scoring", selected = "Strict full recall")
    updateSliderInput(session, "t3_19_n", value = 40)
  })

  t3_result <- reactive({
    if (input$t3_family == "sim19") {
      predict_sim19_detection(input$t3_19_scenario, input$t3_19_scoring, input$t3_19_n)
    } else {
      lookup_sim07_detection(input$t3_07_scenario, as.numeric(input$t3_07_n),
                              as.numeric(input$t3_07_k), input$t3_07_model)
    }
  })

  output$t3_power_display <- renderText({
    r <- t3_result()
    if (input$t3_family == "sim07" && !isTRUE(r$found)) {
      "No published grid point for that combination."
    } else {
      sprintf("Predicted detection rate (p < .05): %.1f%%", 100 * r$power_estimate)
    }
  })

  output$t3_mode_note <- renderUI({
    r <- t3_result()
    if (input$t3_family == "sim19") {
      p(strong(paste0("Mode: ", r$mode, ".")), " ", r$power_source)
    } else {
      p(strong("Mode: exact published grid point (no interpolation available for this family)."))
    }
  })

  output$t3_singular_note <- renderUI({
    if (input$t3_family == "sim19") {
      r <- t3_result()
      p(
        strong("Singular/boundary fits (random-effects estimates on or near a boundary): "),
        if (r$mode == "interpolated") {
          sprintf("%.1f%%-%.1f%% across the two observed endpoints, N = 24 and 60. This is not an observed rate or interval estimate at N = %d.",
                  100 * r$singular_rate_low, 100 * r$singular_rate_high, input$t3_19_n)
        } else {
          sprintf("%.1f%% of replications at the observed N = %d.", 100 * r$singular_rate_low, r$n_used)
        }
      )
    } else {
      p(em("Singular-fit rates were not separately tabulated for the sim_07 grid at these larger N; see outputs/simulation_07_effect_glmm_raw.csv for per-replication convergence diagnostics."))
    }
  })

  output$t3_calibration_table <- renderTable({
    cal <- calibration_report(load_sim19_grid())
    cal <- cal[order(-cal$abs_error_pp), c("scenario", "n_person", "scoring_label",
                                            "actual_sig_rate", "predicted_power", "abs_error_pp")]
    names(cal) <- c("Scenario", "N", "Scoring", "Published sig. rate", "Wald prediction", "Abs. error (pp)")
    head(cal, 10)
  }, digits = 3)

  ## ---- Tab 4 ----
  t5_decision <- reactive({
    alpha_value <- if (input$t5_coeff_status == "reported") input$t5_alpha else NA_real_
    reliability_decision_aid(
      k = input$t5_k,
      alpha = alpha_value,
      p_bar = input$t5_pbar,
      coefficient_status = input$t5_coeff_status,
      primary_claim = input$t5_claim,
      analysis_model = input$t5_analysis_model,
      descriptive_status = input$t5_descriptive_status,
      denominator_policy = input$t5_denominator_policy,
      counterbalance_status = input$t5_counterbalance_status,
      baseline_status = input$t5_baseline_status,
      repeated_testing_status = input$t5_repeated_status,
      control_design = input$t5_control_design,
      scoring_rule = input$t5_scoring_rule,
      high_load = isTRUE(input$t5_high_load),
      hand_scored = isTRUE(input$t5_hand_scored)
    )
  })

  output$t5_overall <- renderText({
    t5_decision()$overall
  })

  output$t5_rbar <- renderText({
    rbar <- t5_decision()$implied_rbar
    if (is.na(rbar)) {
      "Implied average inter-item correlation: not available for this coefficient status/value."
    } else {
      sprintf("Implied average inter-item correlation from the entered coefficient: %.3f", rbar)
    }
  })

  output$t5_decision_table <- renderTable({
    t5_decision()$decisions
  })

  output$t5_download_decision <- downloadHandler(
    filename = function() "reliability_decision_aid.csv",
    content = function(file) {
      write.csv(t5_decision()$decisions, file, row.names = FALSE)
    }
  )

  ## ---- Tab 5 ----
  ## Preset dropdown, ported from Tab 2's observeEvent pattern: auto-fills
  ## delta / person_slope_sd / item_slope_sd from the matching row of
  ## effect_scenario_specs.csv. Unlike Tab 2's choices vector (label mapped to
  ## label), t4_preset's choices are built directly from sim07_scenarios
  ## (label mapped to scenario code), so input$t4_preset holds the scenario
  ## code that specs$scenario is keyed on.
  observeEvent(input$t4_preset, {
    if (input$t4_preset != "custom") {
      specs <- load_effect_scenario_specs()
      row <- specs[specs$scenario == input$t4_preset, ]
      if (nrow(row) == 1) {
        updateNumericInput(session, "t4_delta", value = row$delta)
        updateNumericInput(session, "t4_person_slope_sd", value = row$person_slope_sd)
        updateNumericInput(session, "t4_item_slope_sd", value = row$item_slope_sd)
      }
    }
  })

  t4_script <- reactive({
    generate_simulation_script(
      n_person = input$t4_n, k_per_condition = input$t4_k, delta = input$t4_delta,
      person_slope_sd = input$t4_person_slope_sd, item_slope_sd = input$t4_item_slope_sd,
      scoring = input$t4_scoring, n_rep = input$t4_nrep, seed = input$t4_seed
    )
  })

  output$t4_script_out <- renderText({
    t4_script()
  })

  output$t4_download <- downloadHandler(
    filename = function() "my_design_simulation.R",
    content = function(file) writeLines(t4_script(), file)
  )

  observeEvent(input$t4_copy, {
    session$sendCustomMessage("pd_copy_script", list())
  })
}

## Clientside copy-to-clipboard: vanilla JS only, no new R packages.
copy_js <- "
Shiny.addCustomMessageHandler('pd_copy_script', function(msg) {
  var el = document.getElementById('t4_script_out');
  if (el) {
    navigator.clipboard.writeText(el.innerText).catch(function() {});
  }
});
"
ui <- tagList(ui, tags$script(HTML(copy_js)))

shinyApp(ui = ui, server = server)
