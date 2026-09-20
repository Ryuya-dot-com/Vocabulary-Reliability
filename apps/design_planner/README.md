# Design Planner Shiny App

This directory contains the interactive R/Shiny companion app referenced in
the manuscript and Supplementary Material S0. The app is intended as a
planning and reviewer-diagnostic aid. It does not compute posterior
probabilities, certify a design, or fit a model to user-provided data.
It is optional: the manuscript must remain understandable, reviewable, and
reproducible without launching the app. The durable scope and backend-adoption
rules are recorded in `APP_GOVERNANCE.md`.

The intended distribution route is local launch from the downloaded
anonymized review package or repository. The app is not designed to require a
hosted server during review.

## Run locally

From the repository or review-package root:

```sh
Rscript apps/design_planner/run_local.R
```

Equivalent direct Shiny command:

```sh
R -e 'shiny::runApp("apps/design_planner")'
```

The app runtime uses only `shiny` and `ggplot2`:

```r
install.packages(c("shiny", "ggplot2"))
```

The generated simulation script in Tab 5 is separate from the app runtime. To
run that downloaded script, the R session also needs `dplyr`, `tidyr`, `purrr`,
`tibble`, and `lme4` version 2.0-6 or newer, which are part of the manuscript
analysis environment.
After the required R packages are installed, the interactive app can be used
without internet access because its reference grids are bundled as local CSV
snapshots under `data/`.
If port selection matters on a shared machine, set `DESIGN_PLANNER_PORT`
before using the launcher, for example `DESIGN_PLANNER_PORT=3864 Rscript
apps/design_planner/run_local.R`.

## What the tabs do

- Tab 1 reports expected alpha/KR-20 from item count and average inter-item
  correlation, with floor/ceiling and high-load cautions.
- Tab 2 projects effect-generalizability sensitivity to participant and item
  slope variation. Its bottleneck classification uses the same memory-adjusted
  or unadjusted components as the displayed sampling SD.
- Tab 3 reports detection rates and singular/boundary-fit risk from published
  simulation grid points, with interpolation only between observed sample
  sizes in the small-classroom grid.
- Tab 4 provides a qualitative reliability decision aid: entered evidence
  raises, lowers, or leaves unresolved confidence in specific claims, without
  computing a posterior probability or pass/fail score. Design facts can be
  marked as not reported / unclear rather than replaced with defaults.
- Tab 5 generates a user-specified two-condition counterbalanced sensitivity
  simulation. It does not return an exact answer or certify a design. The
  generated script uses a centered numeric condition contrast, explicit
  diagonal participant/item random-slope structures, and Laplace approximation
  (`nAGQ = 1`). Its lenient-scoring option is labeled as a deliberate
  lower-asymptote model-mismatch stress test.
- The guidance screen maps app inputs to paper sections, practical workflows,
  common problem cases, local-use and privacy notes, defaults, and simulation
  limits.

## Multi-facet design-audit core

`design_audit.R` and `design_audit.js` implement the same dependency-free
pre-computation gate for participant, item, class, school, prefecture, time,
rater, or other explicitly declared facets. The gate never infers nesting from
a facet name. Its versioned JSON contract is in
`data/design_audit.schema.json`, with shared adversarial fixtures in
`data/design_audit_fixtures.json`.

The audit distinguishes four outcomes: `Not identifiable`, `Outside supported
model class`, `Estimable but fragile`, and `Within validated envelope`. The
second state is necessary because a spatial or multiple-membership design can
be scientifically identifiable while still falling outside this lme4-based
app's supported numerical model. The JavaScript module has no DOM, network,
storage, or Node-only runtime dependency, so the same decision logic can be
served as a static Cloudflare asset. The present Shiny UI does not yet expose
the multi-facet editor; this is a tested core contract, not a claim that Tab 5
already simulates arbitrary hierarchies.

## Browser claim router and closed-form parity

`data/inferential_target_registry.json` records the four Figure 1 / Supplement
S2.2 branches as a versioned static artifact: person-score reliability,
condition-effect estimation, effect generalizability, and design/scoring-rule
interpretation. The static frontend in `../design_planner_web` renders aligned
evidence, minimum reporting, and explicit claims that each branch does not
license.

`claim_math.js` ports only two dependency-free identities used by the Shiny
app: expected alpha/KR-20 and the two-facet participant/item
effect-generalizability projection. `data/claim_math_fixtures.json` is shared
by R and JavaScript tests. The browser disables the latter projection unless
the design audit confirms the exact two-condition counterbalanced participant
× item shape; class, school, prefecture, or other condition slopes require a
new offline projection or simulation rather than silent omission.

`build_static_reference_grids.R` converts the provenance-checked sim_19 and
sim_07 CSV snapshots into `data/reference_grids.json`. The artifact contains
two versioned families and all 70 exact published rows. Its contract is
`exact_only`: it supplies a historical detection/singularity reference, not a
design-matching rule or transferable power estimate. Default mode verifies
the committed artifact; `--write` is reserved for regeneration after a source
snapshot changes.

`build_static_decision_artifacts.R` generates two additional contracts.
`data/decision_rules.json` classifies ten calculations into
`browser_static`, `short_r_api`, or `offline_async`, and defines which of the
four validation states may expose a formula, run an assumption sensitivity, or
publish a validated numeric result. `data/golden_test_fixtures.json` records
the R-computed outputs for seven design-audit fixtures, eight closed-form numeric
fixtures, and three reference-grid sentinels. Neither artifact contains a
timestamp or random output, so default verification detects source drift.

`build_app_inventory.R` verifies `data/app_inventory.json`, a source-derived
inventory of the five Shiny features, all declared inputs and assigned
outputs, 21 computation functions, 13 reactive/render/observer paths, package
boundaries, bundled-data identities, and lifecycle rules. It fails when the
source and the classified catalog drift apart. Machine-specific source-load
timing and object sizes are deliberately kept out of that deterministic
artifact; inspect them separately with `probe_app_runtime.R`.

## Defaults and missing reports

Defaults are starting points for sensitivity checks, not substitutes for
reported values. When evaluating a published paper, choose "Not reported /
unclear" for missing design facts instead of inferring them from the app's
defaults. Tabs 1-3 and Tab 5 can show how a hypothetical design behaves as
parameters change; they do not turn unreported information into evidence.

## Practical workflows

If the app feels dense, start from Help's three-question routing table and open
only the section needed for the current task.

- Planning a new experiment: use Tabs 1-3 to compare item count, scoring,
  counterbalancing, and control-design consequences; use Tab 5 when the design
  departs from the published grids.
- Reviewing a submitted paper: use Tab 4 and mark missing design facts as not
  reported / unclear; use Tabs 1-3 only to illustrate why a missing report
  matters, not to replace the submitted study's evidence. The Tab 4 decision
  table can be downloaded as CSV for review notes. If the paper used ANOVA,
  evaluate the analysis unit and item treatment rather than rejecting ANOVA
  automatically. If the paper reports accuracy rates for a GLMM, treat them as
  response-scale descriptives unless model-estimated probabilities and model
  uncertainty are also reported.
- Preparing a manuscript after data collection: use Tab 4 to align claims with
  reportable evidence and use Tab 5 only as sensitivity context; post-hoc
  simulation does not certify a design that cannot be changed. The downloaded
  decision table can be used as a revision checklist.
- For 15-item condition scores, counts and proportions are equivalent when
  the denominator is fixed (for example, 6/15 = .40). If pretest-correct items
  are excluded, the denominator can vary by participant and condition, so
  report eligible denominators and avoid comparing raw counts as if every
  score still had the same maximum.
- To avoid information overload, use one tab for one decision. Planning usually
  starts with the score unit and item count; reviewing usually starts with Tab
  4 and visible evidence only; post-data manuscript preparation usually starts
  by narrowing claims before adding sensitivity checks.

## Validation

From the repository root, the preferred full test command is:

```sh
node scripts/run_design_planner_checks.mjs
```

Successful child-process output is captured and reduced to one summary line.
When a command fails, the wrapper prints its command, exit status, stdout, and
stderr. Add `--quick` to skip the slower Shiny suite, `--verbose` to
show all successful output, or `--fail-fast` to stop at the first failure.

The wrapper covers the following lower-level contracts. These commands remain
available individually for debugging (the R parity tests invoke their paired
JavaScript runners themselves):

```sh
node scripts/test_quiet_test_runner.mjs
Rscript apps/design_planner/test_planner_functions.R
Rscript apps/design_planner/build_bundled_data.R
Rscript --vanilla apps/design_planner/build_static_reference_grids.R
Rscript --vanilla apps/design_planner/build_static_decision_artifacts.R
Rscript --vanilla apps/design_planner/build_app_inventory.R
Rscript --vanilla apps/design_planner/probe_app_runtime.R
Rscript --vanilla apps/design_planner/test_design_audit.R
node apps/design_planner/test_design_audit.js
Rscript --vanilla apps/design_planner/test_claim_math.R
node apps/design_planner/test_claim_math.js
```

`test_planner_functions.R` checks the app's pure functions against the
published manuscript/SI values and verifies that generated simulation scripts
run on reduced replications. `build_bundled_data.R` verifies that the bundled
CSV snapshots in `data/` are mechanically extracted from the repository's own
simulation summaries and scenario specifications. The reference-grid builder
then verifies the R-generated 70-row browser artifact against those snapshots.
The decision-artifact builder verifies the three-way execution registry and
R-computed goldens. The app-inventory builder verifies feature, reactive,
function, dependency, and snapshot drift. The runtime probe only checks that
the current machine can source the UI/server and reports diagnostic timing and
object sizes; it is not a hosted cold-start benchmark. The two design-audit tests
run the R and browser-compatible JavaScript implementations against the same
seven fixtures and compare all decision-bearing fields for cross-runtime
parity. The claim-math pair checks eight additional shared fixtures against the
pure R functions at a fixed numerical tolerance, including a case where memory
adjustment reverses the bottleneck. The Shiny suite also exercises reactive
updates and invalid item-count recovery.

## Privacy and review anonymity

The app has no upload control and does not store user inputs. It computes from
numeric inputs, bundled simulation summaries, and closed-form identities. This
review copy contains no author name, email address, or local file path.
When run locally, the browser address is a local Shiny session, not a public
web service. The app does not contact a hosted database or write a log of typed
inputs; files are written only when the user explicitly downloads a decision
table or generated script.

If the app is later hosted online, hosting-platform access logs may still
exist outside the app itself. For double-anonymous review, the intended route
is local launch from the anonymized repository or review package.
