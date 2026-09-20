# Vocabulary Reliability — Design Planner

Explore how increasing the number of learners or words changes a vocabulary
study's projected sampling variation under stated assumptions.

The browser app offers a guided setup → compare → save workflow, an interactive
sensitivity curve, comparison of up to three assumption sets, and downloadable
base-R code. A local R/Shiny companion provides additional planning tools.
The projections are not power estimates, recommended sample sizes, or evidence
that a study design has been validated.

## Run the browser app

Requires Node.js 22.13+ (22.x) or 24+ and npm. R is not required for the browser app.

```sh
npm --prefix apps/design_planner_web ci
npm --prefix apps/design_planner_web run check
python3 -m http.server 3866 --bind 127.0.0.1 --directory apps/design_planner_web/public
```

Open <http://127.0.0.1:3866/>. Inputs remain in the browser tab; reloading clears
them. The generated R script uses base R and writes comparison CSVs and a PDF.

## Run the Shiny app and extended checks

Install R and the packages used by the app and its checks:

```r
install.packages(c("shiny", "ggplot2", "jsonlite", "tibble", "lme4"))
```

From the repository root:

```sh
Rscript --vanilla apps/design_planner/run_local.R
# Run separately after stopping the local Shiny app:
npm --prefix apps/design_planner_web run check:all
node apps/design_planner_web/test.mjs --check-r
npm --prefix apps/design_planner_web run test:stress
```

The full checks cover R/JavaScript consistency, bundled reference-data
provenance, Shiny behavior, and browser DOM contracts. Stress checks cover
15,000 numerical cases, 2,000 mixed UI operations, 104 R parity cases, and three
extreme-input R exports. They do not establish a statistical validation range
or replace tests with novice users.

## Contents and provenance

- [`apps/design_planner_web`](apps/design_planner_web/README.md): static browser app, build, tests, and Cloudflare configuration.
- [`apps/design_planner`](apps/design_planner/README.md): Shiny app, shared calculation functions, and reference snapshots.
- `scripts/` and the three simulation-summary/projection CSVs in `outputs/`: sources required by the reference-data and regression checks. The simulation source is parsed by the provenance check; no Monte Carlo simulation runs in a page request.
- [`outputs/design_planner_examples`](outputs/design_planner_examples/): an illustrative downloadable R script.
- [`review/web_planner_usability_20260919.md`](review/web_planner_usability_20260919.md): implementation QA and a protocol for novice user testing, which has not yet been conducted.

This repository publishes the application and files needed for its execution
and verification. Manuscript files, reviewer correspondence, submission
packages, local credentials, and the research repository's Git history are not
included. References within app documentation to the manuscript or supplement
describe external scientific context; those documents are not bundled here.

## Deployment

The deployable directory is `apps/design_planner_web/public`. The selected
publication route is Cloudflare Pages Direct Upload, using a generic
`<project-name>.pages.dev` hostname. See the
[deployment instructions](apps/design_planner_web/README.md#deployment-validation)
for checks and commands. `npm run deploy` is deliberately a Workers dry run;
actual Pages publication uses Wrangler's explicit `pages deploy` command.

A public GitHub repository under an author's account is not an anonymous review
channel. The static app's content checks alone cannot make its hosting URL or
source repository anonymous.
