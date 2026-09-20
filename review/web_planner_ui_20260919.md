# Web planner: interactive comparison and staged UX

Implemented in response to the request for interactive visualization, downloadable R code, refined CSS and progressive disclosure.

## UX assessment and changes

The previous screen exposed the four research targets, structural audit, numerical inputs, interpretation and reporting text together. Before trying a comparison, a newcomer had to distinguish several technical concepts. This was a substantial information-ordering problem; adding another chart alone would not resolve it.

The default entrance now presents a single question and a three-stage preview. The workflow is **Set up → Compare → Save & reproduce**. Only the current stage is visible, and forward/back navigation preserves inputs. Initial input consists of participant count and words per condition. Slope and memory assumptions are editable in a disclosure; a summary of their current values remains visible. The two-condition counterbalancing requirement is explained before calculation. The four original research branches remain available through **All research tools**, with structural auditing separately expandable.

The supplied [UI Library](https://design-library.jp/ui/) was read and inspected in Chrome. Its clear section headings, whitespace and separation of navigation from content informed the visual direction. The implementation uses restrained blue and amber accents, flatter sections, clearer active steps, larger count inputs and responsive spacing. It does not reproduce an individual gallery entry.

This is a design assessment and implementation, not evidence from novice user testing. Slope SDs, the latent scale and the distinction between sampling variation and fitted-model SE remain learning demands. A useful next evaluation is whether new users can identify the assumed design, explain what a lower curve means, change a variation assumption and recognize that the output is not power.

## Visualization

- Native SVG curves compare changing learners with changing words, from +0% to +200% at 5% increments. Counts round upward to whole learners or words per condition; actual counts are displayed.
- Hover changes a clearly labeled preview; clicking commits a selection. A native slider provides touch and keyboard access to the same selection.
- The selected increase updates the exact table, narrative, reporting draft, JSON and generated R together. Solid/dashed lines and an exact-value table supplement color.
- The SVG coordinate system adapts to the available width so labels remain readable on narrow displays. No Plotly dependency, external asset or server request was added.
- The formula and inferential scope are unchanged. These are assumed latent-effect sampling SDs, not fitted GLMM standard errors, power or newly validated performance envelopes. Equal percentage increases do not imply equal cost.

## R export

The download contains current counts, slope SDs, memory variation/adjustment, selected percentage increase, the calculation formula, scope notes and all 41 curve points. It uses base R only and writes comparison CSV, curve CSV and PDF output in the working directory. The code can be inspected before downloading. It does not install packages, simulate responses or fit models.

An illustrative export is provided in `outputs/design_planner_examples/vocabulary-design-sensitivity.R` (N=120, k=15 per condition, 100% increase). It is generated through the same page logic as the download.

Invalid inputs or blocked designs clear results/code, disable export and forward navigation, and return to setup. Missing variation inputs open the relevant disclosure so the user can correct them.

## Verification and limits

- Static tests cover stage visibility, keyboard-focus targets, retained input, curve selection, hover-versus-selection behavior, count rounding, JSON/report/R consistency, invalid-input recovery and disabled export for blocked designs.
- A simulated download captures the actual Blob and filename, verifying that the file content equals the preview.
- `node apps/design_planner_web/test.mjs --check-r` executed the exported script in four cases: unadjusted, memory adjusted, 25% increase with rounding, and zero included variance. Comparison SDs/reductions and each of the 41 curve points agreed with the browser calculation within 1e-12. CSV and PDF files were produced.
- `npm --prefix apps/design_planner_web run check` passed after the final changes (build, static tests, anonymous-release gate); `git diff --check` passed.
- Chrome checks covered the entry, stage navigation, chart click, slider arrow keys, invalid input/recovery, separate research tools, a non-identifiable design blocking export, and code-download action. Desktop, 390px and 320px viewport layouts were inspected. Narrow views had no page-wide horizontal overflow; these were browser viewport checks, not physical-device tests.
- The Chrome download-management page was blocked by the browser tool's URL policy, and the targeted download-event observer timed out, so those checks did not establish filesystem-save completion. The user subsequently confirmed the saved file and supplied its local path. Reading that file confirmed that it matches the illustrative export except for `increase_percent <- 95`, consistent with the slider selection at the first download. Actual file-save completion is now confirmed.
- No novice usability study, other-browser matrix or public deployment was performed. The local preview is left running at `http://127.0.0.1:3866/` with Chrome returned to its normal width for review.

## Follow-up: interpretation and assumption guidance

The comparison now leads with a plain-language takeaway above the chart, followed by actual counts and SD reductions. Its heading explicitly conditions the conclusion on the assumptions. Variance contributions and raw SD explanations sit inside the existing exact-values disclosure. The takeaway has separate states for equal projections, no selected increase and zero included variation; it does not recommend a sample size or describe the comparison as power.

Input help uses teaching-method examples to distinguish variation in the condition difference from general learner ability or word difficulty. A further disclosure explains compatible pilot/prior estimates, the logit scale, exploring plausible alternatives and documenting sensitivity. Memory help distinguishes the separately entered memory component from the remaining learner variation and explains the full-adjustment assumption. No new numerical defaults or universal small/large thresholds are introduced.

**Try different assumptions** returns to setup, opens the assumptions and focuses the learner slope input while retaining study counts and the selected expansion. The summary stays tied to the selected point during chart hover, and the reporting draft includes the same conclusion.

Verification: the static build/test/anonymous-release checks passed. Added checks cover both conclusion directions, tied projections, no increase, zero variation, actual rounded counts, hover/selection separation, invalid/blocked-result clearing, and return navigation with preserved values. Chrome confirmed the initial 15.0% versus 11.8% reductions and the switch to favoring words after changing the word slope SD from 0.18 to 0.6 (2.6% versus 25.8%). Desktop, 390px and 320px layouts were inspected; the expanded guidance and comparison remained within the 320px page width. This is implementation QA, not a novice comprehension study. The calculation formula and exported R script were unchanged.

## Follow-up: compare up to three assumption sets

**Keep these assumptions** retains the current learner slope SD, word slope SD, memory variation and adjustment status. Up to three distinct sets can be compared; duplicate sets and a fourth set are blocked. Keeping a set opens and scrolls to the comparison. The existing curve continues to show the current inputs, and **Use in chart** restores a kept set's assumptions. Removing a set frees its slot without renumbering the others.

Every set uses the current common participant count, word count and selected increase. Changing those controls recalculates all kept sets, including count rounding. The cards show inputs, starting SD, expanded-plan SDs and reductions. The summary identifies opposite conclusions, agreement within the selected sets, ties, no selected increase and undefined reductions from zero included variance. Agreement is explicitly limited to the compared sets and does not establish a validated parameter range or broader robustness. Invalid/blocked designs hide the comparisons and disable keeping/export without discarding the retained assumptions.

The existing JSON now includes shared counts, kept inputs, results and summary. The reporting draft records each kept set. When sets exist, the base-R download includes their inputs and calculations and writes an additional `vocabulary-assumption-comparison.csv`; its PDF still shows the current chart assumptions. All state remains local to the page and is cleared by reload. No dependency, storage service or numerical projection formula was added.

Verification: `npm --prefix apps/design_planner_web run check` passed after the final code changes. `node apps/design_planner_web/test.mjs --check-r` executed eight exports, including four with kept sets; 11 kept-set rows reproduced the browser's counts, inputs, SDs, reductions and comparison direction (numeric tolerance 1e-12). Existing current-plan/41-point-curve/PDF checks also passed. New UI tests cover independent retention, duplicate/capacity limits, shared-count recalculation and rounding, hover separation, use/remove, reversed/equal/mixed/zero-variance conclusions, and invalid-input recovery.

Chrome checks covered keeping three sets, the conclusion reversal after changing word slope SD from 0.18 to 0.6, memory-adjustment differences, keyboard navigation and reuse, removal, and the updated export notice/report. Desktop cards and stacked cards at 390px/320px were inspected; both narrow pages matched their viewport width with no horizontal page overflow. These are viewport checks, not physical-device or novice usability tests. The local preview retains two illustrative sets for inspection; no public deployment was performed.

## Follow-up: numerical and interaction stress checks

Added deterministic stress tests for 12,000 projection inputs, 3,000 alpha inputs, 2,000 mixed JSDOM operation steps, 104 R/JavaScript parity cases and three extreme-input R exports. They exposed misleading rounding of small positive SDs, numeric underflow, unsafe expanded counts and stale explanations after a late calculation error. Scientific notation, numerical range checks and consistent result clearing now address these cases. The formula is unchanged; shared R functions and generated R also receive numerical guards. See [the stress-test record](web_planner_stress_20260919.md) for results, reproduction commands, Chrome checks and limits. These tests do not establish a validated statistical envelope or hosted-service load capacity.

## Follow-up: resume, keyboard access and usability protocol

An overview-to-planner walkthrough exposed an unintended reset of edited inputs. Overview now offers **Resume your comparison** separately from **Restart with example inputs**, with reset effects stated explicitly. Resume preserves the current design and cannot bypass its calculation gate. Slider value text now includes the percentage and rounded study sizes, input errors retain their help association, guided heading levels no longer begin at H4, and focus outlines are stronger and cover focusable regions.

Static checks and the 2,000-step stress sequence including resume passed. Chrome confirmed keyboard navigation, resume with retained values, error recovery, and 320px overview/export layouts. The [usability protocol and QA record](web_planner_usability_20260919.md) contains five participant tasks, observer answer criteria, an empty record template and remaining limits. Novice participant testing and actual screen-reader speech testing have not yet been conducted.

## Follow-up: stable comparison controls (2026-09-20)

Valid updates retain the comparison in layout. The variable-length takeaway now
follows the chart, slider and readouts; switching to 0% no longer shifts the
slider. Using a kept set focuses the slider; deleting one focuses a neighboring
remove button or the change-assumptions button. Desktop and 390px Chrome checks
confirmed unchanged scroll and slider positions across 0%/200% boundaries.
The build versions CSS/script URLs with their content hashes to avoid mixing
new HTML with cached older code. Static checks and stress tests passed; exact
measurements and verification limits are in the linked usability record.
