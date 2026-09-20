# Design Planner Governance and Scope Boundary

## Product hierarchy

The revised manuscript, point-by-point response letter, and reproducible
analysis record are the primary revision products. The Design Planner is an
optional companion. A reader must be able to understand the argument, a
reviewer must be able to judge the claims, and an analyst must be able to
reproduce the reported results without launching either the Shiny app or the
public static frontend.

The app may explain an inferential route, expose an assumption, reproduce a
versioned reference value, or generate an offline sensitivity-analysis script.
It may not certify a design, replace missing reports with defaults, convert
uncertainty into a generic pass/fail score, or silently broaden a claim beyond
the design that identifies it. It has no data-upload or input-persistence
role.

## Architectural boundary

The local Shiny interface is a convenience layer. Its deterministic
calculations live in `planner_functions.R`; source-derived features,
dependencies, bundled snapshots, and reactive paths are recorded in
`data/app_inventory.json`. The public application is static-first: its core
routing, design audit, closed-form identities, reporting prompts, and exact
published-grid rows remain available when no R process exists.

Monte Carlo simulation, model fitting, and validation-envelope expansion are
offline work. They never run inside a synchronous page request. Machine-local
source/bootstrap performance can be inspected with `probe_app_runtime.R`, but
that observation is not treated as a hosted cold-start service-level promise.

## Gate for adding a synchronous R API

A stateless R endpoint is justified only if every condition below is met:

1. A reviewer comment, manuscript claim gap, or reproducibility obligation
   requires a bounded deterministic calculation.
2. The calculation cannot reasonably be implemented from reviewed static
   artifacts or a dependency-light JavaScript port.
3. Its input schema, numerical contract, package lock, deadline, cancellation
   behavior, retry limit, and static degraded mode are specified before
   implementation.
4. Backend loss cannot hide the corresponding manuscript evidence or block the
   public app's core decision path.
5. Cross-runtime golden tests and an operational owner exist.

No current public calculation satisfies this gate. Therefore the short R API
remains an explicitly unimplemented pathway, not unfinished infrastructure on
which the released app depends.

## Scope-control questions

Before adding a feature, answer these questions in order:

- Which reviewer comment, claim, or reproduction obligation does it close?
- Could a manuscript sentence, response-letter table, or static artifact close
  the same gap more directly?
- Which inferential target does it serve, and what does its output not license?
- Does it introduce a new estimand, design class, package, backend, log, secret,
  maintenance duty, or privacy surface?
- What test will detect drift, and what remains usable when the feature is
  retired?

If the first question has no concrete answer, the feature is out of revision
scope. If the second answer is yes, prefer the manuscript or static artifact.

## Stop and retirement conditions

Once the reviewer-comment matrix, manuscript edits, response-letter evidence,
and reproducibility checks are complete, app work stops unless a remaining
comment demonstrably depends on it. A tempting enhancement is not a blocker to
submission.

If the local Shiny runtime or a future backend becomes unmaintainable, preserve
the versioned static snapshot, artifact checksums, source code, and documented
limitations. Do not keep a live service merely because it once existed. A
graceful archived companion is preferable to an opaque, intermittently
available dependency.
