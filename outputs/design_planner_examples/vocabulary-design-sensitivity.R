# Vocabulary design planner: reproduce the current sensitivity comparison
# Run with Rscript --vanilla vocabulary-design-sensitivity.R, or source in RStudio.
# Base R only. This script writes/overwrites three vocabulary-*.csv/pdf files
# in the working directory. It does not install packages or use a network.
#
# Scope: exactly two counterbalanced conditions, crossed learners and words,
# with a condition slope for both facets. Counts below are hypothetical;
# they do not replace counts in the separate design-structure audit.
# Variation is on the latent logit scale. Assumptions are not fitted estimates.
# Excludes response-level estimation error and moderator-estimation uncertainty.
# This is NOT fitted-model SE, power, simulation, or design validation.
# Learning time, exposure and the response process are held constant.
# Equal proportional increases do not imply equal costs.
# Claim-math contract: 1.0.0

# 1. Current inputs (edit these to explore other assumptions)
n_person <- 120
k_per_condition <- 15
person_slope_sd <- 0.35
item_slope_sd <- 0.18
memory_moderation <- 0.2
memory_adjusted <- FALSE
increase_percent <- 100

stopifnot(all(is.finite(c(n_person, k_per_condition, person_slope_sd,
                         item_slope_sd, memory_moderation, increase_percent))),
          n_person >= 1, n_person <= 30023997515803, n_person == floor(n_person),
          k_per_condition >= 1, k_per_condition <= 30023997515803, k_per_condition == floor(k_per_condition),
          person_slope_sd >= 0, item_slope_sd >= 0, memory_moderation >= 0,
          is.logical(memory_adjusted), length(memory_adjusted) == 1L,
          !is.na(memory_adjusted), increase_percent >= 0, increase_percent <= 200)

# 2. Closed-form projection; total words = 2 * k_per_condition
# Fully accounting for memory removes that component from learner variation.
project_sd <- function(n, k, person = person_slope_sd, word = item_slope_sd,
                       memory = memory_moderation, adjusted = memory_adjusted) {
  person_term <- (person^2 + ifelse(adjusted, 0, memory^2)) / n
  item_term <- word^2 / (2 * k)
  # Reject overflow and subnormal/underflowed positive variance terms.
  stopifnot(all(is.finite(person_term + item_term)),
    all((person == 0 & (adjusted | memory == 0)) | person_term >= .Machine$double.xmin),
    all(word == 0 | item_term >= .Machine$double.xmin))
  sqrt(person_term + item_term)
}
expand_count <- function(count, percent) ceiling(count * (100 + percent) / 100)
baseline_sd <- project_sd(n_person, k_per_condition)

comparison <- data.frame(
  plan = c("Current plan", "More learners", "More words"),
  learners = c(n_person, expand_count(n_person, increase_percent), n_person),
  words_per_condition = c(k_per_condition, k_per_condition,
                          expand_count(k_per_condition, increase_percent)))
comparison$total_words <- 2 * comparison$words_per_condition
comparison$sampling_sd <- with(comparison, project_sd(learners, words_per_condition))
comparison$sd_reduction <- if (baseline_sd > 0) 1 - comparison$sampling_sd / baseline_sd else NA_real_
stopifnot(all(is.finite(comparison$sampling_sd)))
print(comparison, row.names = FALSE, digits = 8)
write.csv(comparison, "vocabulary-comparison.csv", row.names = FALSE)

# 3. Sensitivity curves: counts are rounded UP, as in the web interface.
curve <- data.frame(increase_percent = seq(0, 200, by = 5))
curve$learners <- expand_count(n_person, curve$increase_percent)
curve$total_words <- 2 * expand_count(k_per_condition, curve$increase_percent)
curve$sd_more_learners <- project_sd(curve$learners, k_per_condition)
curve$sd_more_words <- project_sd(n_person, curve$total_words / 2)
stopifnot(all(is.finite(curve$sd_more_learners)), all(is.finite(curve$sd_more_words)))
write.csv(curve, "vocabulary-sensitivity-curve.csv", row.names = FALSE)

# The PDF is a static reproduction of the two browser curves.
pdf("vocabulary-sensitivity.pdf", width = 8, height = 5)
plot(curve$increase_percent, curve$sd_more_learners, type = 'l', lwd = 2,
     col = '#465FD4', ylim = c(0, if (baseline_sd > 0) baseline_sd * 1.1 else 1),
     xlab = "Requested increase in one count (%)", ylab = "Projected sampling SD",
     main = "More learners or more words?")
lines(curve$increase_percent, curve$sd_more_words, col = '#B46632', lty = 2, lwd = 2)
abline(v = increase_percent, col = 'gray60', lty = 3)
points(rep(increase_percent, 2), comparison$sampling_sd[2:3], pch = c(16, 17),
       col = c('#465FD4', '#B46632'))
legend("topright", c("More learners", "More words"),
       col = c('#465FD4', '#B46632'), lty = c(1, 2), lwd = 2, bty = 'n')
mtext("Assumption-based projection; not fitted-model SE or power.", side = 3, cex = 0.8)
invisible(dev.off())

# If all included variance components are zero, reductions are undefined.
# A zero projected SD does not imply perfect precision.
# Next: repeat with plausible slope SDs, then consider cost, exposure and fatigue.
