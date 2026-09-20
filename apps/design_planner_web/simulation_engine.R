# Engine for a declared two-list participant x item binomial design.
# Predictors are generated independently: normal numeric values or equiprobable
# categorical levels, at the declared learner/word/response level. No time series,
# correlated covariates, fatigue, exposure changes or informative knownness.

validate_simulation_config <- function() {
  stopifnot(config$n >= 4, config$n <= 5000, config$n %% 2 == 0,
            config$k >= 2, config$k <= 500, config$k == floor(config$k),
            config$fillers >= 0, config$fillers <= 1000, config$fillers == floor(config$fillers),
            config$n * 2 * config$k * length(config$beta) <= 2000000,
            is.finite(config$alpha), config$alpha > 0, config$alpha < 1,
            config$test_term %in% names(config$beta), config$test_term != "(Intercept)",
            all(is.finite(unlist(config$beta))))
  probabilities <- c(config$known_rate, config$known_accuracy, config$filler_accuracy)
  stopifnot(all(is.finite(probabilities)), all(probabilities >= 0 & probabilities <= 1),
            config$policy %in% c("all_targets", "unknown_only"),
            config$policy == "unknown_only" || config$known_rate == 0)
  for (p in config$predictors) {
    stopifnot(p$unit %in% c("learner", "word", "response"), p$type %in% c("numeric", "factor"))
    if (p$type == "numeric") stopifnot(is.finite(p$mean), is.finite(p$sd), p$sd > 0) else
      stopifnot(p$levels >= 2, p$levels <= 100, p$levels == floor(p$levels))
  }
  for (random in config$random) {
    sds <- c(random$intercept_sd, random$condition_sd, random$additional_sd)
    stopifnot(all(is.finite(sds)), all(sds >= 0), is.finite(random$rho),
              random$covariance %in% c("diag", "us"), random$covariance == "us" || random$rho == 0)
    if (random$dimension > 1) stopifnot(random$rho > -1 / (random$dimension - 1), random$rho < 1)
  }
  invisible(TRUE)
}

simulate_study <- function(seed) {
  set.seed(seed)
  n <- config$n; j <- 2L * config$k
  d <- expand.grid(participant = factor(seq_len(n)), item = factor(seq_len(j)))
  # Randomly allocate equal-sized counterbalancing lists to learners and words.
  person_list <- sample(rep(c(0L, 1L), length.out = n))
  word_list <- sample(rep(c(0L, 1L), length.out = j))
  pi <- as.integer(d$participant); wi <- as.integer(d$item)
  d$condition_c <- ifelse((person_list[pi] + word_list[wi]) %% 2L == 0L, -.5, .5)
  for (p in config$predictors) {
    index <- switch(p$unit, learner = pi, word = wi, response = seq_len(nrow(d)))
    size <- max(index)
    values <- if (p$type == "numeric") rnorm(size, p$mean, p$sd) else
      factor(sample(seq_len(p$levels), size, replace = TRUE), levels = seq_len(p$levels))
    d[[p$name]] <- values[index]
  }
  fixed <- model.matrix(delete.response(terms(lme4::nobars(model_formula))), d)
  beta <- unlist(config$beta)
  if (!setequal(colnames(fixed), names(beta))) stop("Generated fixed coefficients differ from the specification.")
  eta <- drop(fixed %*% beta[colnames(fixed)])
  for (facet in c("participant", "item")) {
    random <- config$random[[facet]]
    Z <- model.matrix(as.formula(random$formula), d)
    if (ncol(Z) != random$dimension) stop("Random-effect columns differ from the specification.")
    sds <- rep(random$additional_sd, ncol(Z))
    sds[colnames(Z) == "(Intercept)"] <- random$intercept_sd
    sds[colnames(Z) == "condition_c"] <- random$condition_sd
    # Equicorrelation is a DGP restriction, not a fitted cs covariance structure.
    # The fit uses the selected diag/us structure; us estimates all correlations.
    correlation <- matrix(random$rho, ncol(Z), ncol(Z)); diag(correlation) <- 1
    effects <- matrix(rnorm(nlevels(d[[facet]]) * ncol(Z)), ncol = ncol(Z)) %*% chol(correlation)
    effects <- sweep(effects, 2, sds, "*")
    eta <- eta + rowSums(Z * effects[as.integer(d[[facet]]), , drop = FALSE])
  }
  if (any(!is.finite(eta))) stop("Non-finite linear predictor; revise effect/variance assumptions.")
  d$item_role <- "target"
  # Independent eligibility thinning only: not an ability/difficulty-based screen.
  d$pretest_known <- runif(nrow(d)) < config$known_rate
  d$outcome <- rbinom(nrow(d), 1, plogis(eta))
  if (any(d$pretest_known)) d$outcome[d$pretest_known] <- rbinom(sum(d$pretest_known), 1, config$known_accuracy)
  target_correct <- tabulate(pi[d$outcome == 1], nbins = n)
  eligible <- tabulate(pi[!d$pretest_known], nbins = n)
  unknown_correct <- tabulate(pi[!d$pretest_known & d$outcome == 1], nbins = n)
  eligible_cells <- tabulate((pi + n * (d$condition_c > 0))[!d$pretest_known], nbins = 2L * n)
  # Fillers are generated last and never enter the condition-effect fit.
  # Each replication has its own seed, so changing fillers preserves target draws.
  filler_correct <- rbinom(n, config$fillers, config$filler_accuracy)
  unknown_scores <- ifelse(eligible > 0, unknown_correct / eligible, NA_real_)
  list(data = d, diagnostics = list(
    eligible_responses = sum(eligible), eligible_condition_a = sum(eligible_cells[seq_len(n)]),
    eligible_condition_b = sum(eligible_cells[n + seq_len(n)]),
    zero_eligible_learner_condition_cells = sum(eligible_cells == 0), min_eligible_per_learner = min(eligible),
    max_eligible_per_learner = max(eligible), zero_eligible_learners = sum(eligible == 0),
    mean_target_score = mean(target_correct / j),
    mean_unknown_score = if (all(is.na(unknown_scores))) NA_real_ else mean(unknown_scores, na.rm = TRUE),
    mean_feedback_score = mean((target_correct + filler_correct) / (j + config$fillers))))
}

simulate_replication <- function(index, seed, fit_fun = fit_study) {
  result <- data.frame(replication = index, seed = seed, status = "failed", usable = FALSE,
    eligible_condition_a = NA_integer_, eligible_condition_b = NA_integer_,
    zero_eligible_learner_condition_cells = NA_integer_,
    singular = NA, estimate = NA_real_, se = NA_real_, p_value = NA_real_,
    covered_95 = NA, warning = "", error = "", eligible_responses = NA_integer_,
    min_eligible_per_learner = NA_integer_, max_eligible_per_learner = NA_integer_,
    zero_eligible_learners = NA_integer_, mean_target_score = NA_real_,
    mean_unknown_score = NA_real_, mean_feedback_score = NA_real_)
  warnings <- character()
  tryCatch(withCallingHandlers({
    generated <- simulate_study(seed)
    for (name in names(generated$diagnostics)) result[[name]] <- generated$diagnostics[[name]]
    fit <- fit_fun(generated$data)
    result$singular <- lme4::isSingular(fit, tol = 1e-4)
    co <- summary(fit)$coefficients
    if (!config$test_term %in% rownames(co)) stop("Test coefficient was dropped or is absent.")
    result$estimate <- unname(co[config$test_term, "Estimate"])
    result$se <- unname(co[config$test_term, "Std. Error"])
    messages <- fit@optinfo$conv$lme4$messages
    # A singular boundary is reported separately, not silently discarded.
    messages <- messages[!grepl("boundary \\(singular\\)", messages)]
    optimizer <- fit@optinfo$conv$opt
    converged <- !length(messages) && (is.null(optimizer) || all(optimizer == 0))
    result$status <- if (converged) "converged" else "nonconverged"
    if (length(messages)) warnings <- c(warnings, messages)
    result$usable <- converged && is.finite(result$estimate) && is.finite(result$se) && result$se > 0
    if (result$usable) {
      result$p_value <- 2 * pnorm(-abs(result$estimate / result$se))
      truth <- unlist(config$beta)[config$test_term]
      result$covered_95 <- abs(result$estimate - truth) <= qnorm(.975) * result$se
    } else if (converged) result$status <- "invalid_estimate"
  }, warning = function(w) { warnings <<- c(warnings, conditionMessage(w)); invokeRestart("muffleWarning") },
  message = function(m) { warnings <<- c(warnings, conditionMessage(m)); invokeRestart("muffleMessage") }),
  error = function(e) { result$error <<- conditionMessage(e) })
  result$warning <- paste(unique(warnings), collapse = " | ")
  result
}

rate_summary <- function(successes, denominator) {
  if (!denominator) return(c(rate = NA_real_, mcse = NA_real_, low = NA_real_, high = NA_real_))
  p <- successes / denominator; z <- qnorm(.975)
  center <- (p + z^2 / (2 * denominator)) / (1 + z^2 / denominator)
  half <- z * sqrt(p * (1 - p) / denominator + z^2 / (4 * denominator^2)) / (1 + z^2 / denominator)
  c(rate = p, mcse = sqrt(p * (1 - p) / denominator), low = max(0, center - half), high = min(1, center + half))
}

summarize_simulation <- function(results) {
  usable <- results$usable
  detected <- usable & !is.na(results$p_value) & results$p_value < config$alpha
  n <- nrow(results); nu <- sum(usable)
  rejection <- rate_summary(sum(detected), nu)
  nonsingular <- usable & !is.na(results$singular) & !results$singular
  rejection_ns <- rate_summary(sum(detected & nonsingular), sum(nonsingular))
  coverage <- rate_summary(sum(results$covered_95[usable]), nu)
  truth <- unlist(config$beta)[config$test_term]
  estimates <- results$estimate[usable]
  data.frame(test_term = config$test_term, true_coefficient = truth, alpha = config$alpha,
    interpretation = if (truth == 0) "Type I error for this coefficient" else "Power for this coefficient",
    requested_reps = n, usable_reps = nu, failed_reps = sum(results$status == "failed"),
    invalid_estimate_reps = sum(results$status == "invalid_estimate"), unusable_reps = n - nu,
    nonconverged_reps = sum(results$status == "nonconverged"),
    singular_fits = sum(results$singular, na.rm = TRUE), usable_nonsingular_reps = sum(nonsingular),
    rejection_usable = rejection["rate"], rejection_mcse = rejection["mcse"],
    rejection_wilson_low = rejection["low"], rejection_wilson_high = rejection["high"],
    rejection_nonsingular_low = rejection_ns["low"], rejection_nonsingular_high = rejection_ns["high"],
    rejection_nonsingular = rejection_ns["rate"], rejection_nonsingular_mcse = rejection_ns["mcse"],
    usable_and_significant_fraction = sum(detected) / n,
    rejection_missing_lower = sum(detected) / n, rejection_missing_upper = (sum(detected) + n - nu) / n,
    coverage_wilson_low = coverage["low"], coverage_wilson_high = coverage["high"],
    coverage_95_usable = coverage["rate"], coverage_mcse = coverage["mcse"],
    bias_usable = if (nu) mean(estimates - truth) else NA_real_,
    bias_mcse = if (nu > 1) sd(estimates) / sqrt(nu) else NA_real_,
    empirical_sd = if (nu > 1) sd(estimates) else NA_real_,
    mean_model_se = if (nu) mean(results$se[usable]) else NA_real_, row.names = NULL)
}

run_simulation <- function(n_rep = config$reps, seed = config$seed,
                           output_dir = tempfile("vocabulary-simulation-", tmpdir = getwd()),
                           fit_fun = fit_study) {
  if (!requireNamespace("lme4", quietly = TRUE)) stop("Install lme4 separately before running.")
  if (packageVersion("lme4") < "2.0.6") stop("Use lme4 2.0.6 or newer for the covariance syntax.")
  stopifnot(length(n_rep) == 1L, is.finite(n_rep), n_rep == floor(n_rep), n_rep >= 2, n_rep <= 10000,
            length(seed) == 1L, is.finite(seed), seed == floor(seed), seed >= 1, seed + n_rep <= .Machine$integer.max)
  validate_simulation_config()
  if (dir.exists(output_dir) || file.exists(output_dir)) stop("Output path already exists; choose a new directory.")
  if (!dir.create(output_dir)) stop("Cannot create output directory.")
  old_options <- options(contrasts = c("contr.treatment", "contr.poly"))
  on.exit(options(old_options), add = TRUE)
  actual_config <- config; actual_config$reps <- n_rep; actual_config$seed <- seed
  dput(actual_config, file = file.path(output_dir, "assumptions.R"))
  writeLines(capture.output(sessionInfo()), file.path(output_dir, "session-info.txt"))
  rows <- vector("list", n_rep)
  # Append each replication immediately, so completed work survives interruption.
  for (i in seq_len(n_rep)) {
    rows[[i]] <- simulate_replication(i, seed + i - 1L, fit_fun)
    write.table(rows[[i]], file.path(output_dir, "replications.csv"), sep = ",",
                row.names = FALSE, col.names = i == 1L, append = i > 1L, na = "NA")
    if (i == 1L || i %% 10L == 0L || i == n_rep) message("Replication ", i, "/", n_rep)
  }
  results <- do.call(rbind, rows)
  summary <- summarize_simulation(results)
  write.csv(summary, file.path(output_dir, "summary.csv"), row.names = FALSE, na = "NA")
  notes <- c(
    "Assumption-based simulation, not design certification or a sample-size recommendation.",
    paste("Test:", config$test_term, "; two-sided asymptotic Wald test; alpha =", config$alpha),
    "The condition main coefficient is at numeric predictors = 0 and categorical reference levels, not a marginal average with interactions.",
    "Rejection/coverage summaries use converged finite estimates, including singular fits; nonsingular rejection is a separate sensitivity summary.",
    "Missing-result bounds range from none to all unusable replications being significant. Do not report conditional power without failure counts.",
    "Wilson intervals quantify Monte Carlo uncertainty; MCSE alone can be zero at observed rates 0 or 1.",
    "Inspect replications.csv warnings, convergence, singularity, eligibility and scores. Successful execution does not validate Wald calibration.",
    "Set the tested coefficient to zero and rerun to examine Type I error under the same nuisance effects.",
    "Covariates are independent normal/equiprobable categories; no covariate correlations or repeated-time schedule are modeled.",
    "Pretest-known status is independent of latent ability, difficulty and condition; this is not an informative screening model.",
    "Fillers are independent feedback-only responses. They do not enter target fits or increase target information; no motivation effect is modeled.",
    "For unknown-only policy, known targets have their own correctness probability and are excluded; zero eligible scores are undefined.",
    "Compare multiple plausible settings. Keep effect coding, target population, costs, learning exposure and fatigue in view.")
  writeLines(notes, file.path(output_dir, "README.txt"))
  print(summary)
  message("Saved simulation outputs to: ", normalizePath(output_dir))
  invisible(list(summary = summary, replications = results, output_dir = output_dir))
}
