#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(purrr)
  library(ggplot2)
  library(lme4)
  library(readr)
  library(stringr)
})

source(file.path("scripts", "common_reliability.R"))

set.seed(20260628 + 7)

out_dir <- Sys.getenv("SIM_OUT_DIR", "outputs")
fig_dir <- file.path(out_dir, "figures")
ensure_output_dirs(out_dir)

inv_logit <- function(x) plogis(x)
clip01 <- function(x) pmin(pmax(x, 1e-4), 1 - 1e-4)

alpha_binary <- function(x) {
  x <- as.matrix(x)
  storage.mode(x) <- "numeric"
  k <- ncol(x)
  if (k < 2) {
    return(tibble(alpha = NA_real_, zero_var_items = NA_integer_, mean_score = mean(rowMeans(x), na.rm = TRUE)))
  }

  item_vars <- apply(x, 2, var, na.rm = TRUE)
  total_scores <- rowSums(x, na.rm = TRUE)
  total_var <- var(total_scores, na.rm = TRUE)
  zero_var_items <- sum(is.na(item_vars) | item_vars < 1e-12)

  alpha <- if (is.na(total_var) || total_var < 1e-12) {
    NA_real_
  } else {
    k / (k - 1) * (1 - sum(item_vars, na.rm = TRUE) / total_var)
  }

  tibble(alpha = alpha, zero_var_items = zero_var_items, mean_score = mean(rowMeans(x), na.rm = TRUE))
}

scenario_specs <- tribble(
  ~scenario, ~scenario_label, ~base, ~guessing, ~person_intercept_sd, ~memory_score_slope, ~item_intercept_sd, ~delta, ~person_slope_sd, ~item_slope_sd, ~memory_moderation, ~interpretation,
  "alpha_high_effect_stable", "High alpha, stable effect", -0.40, 0.00, 0.85, 0.35, 0.55, 0.75, 0.05, 0.05, 0.00, "Alpha and effect model agree; low item/person treatment heterogeneity.",
  "alpha_high_item_sensitive", "High alpha, item-sensitive effect", -0.40, 0.00, 0.85, 0.35, 0.55, 0.75, 0.05, 0.65, 0.00, "Alpha can be high while the treatment effect depends strongly on which words were sampled.",
  "alpha_high_person_sensitive", "High alpha, person-sensitive effect", -0.40, 0.00, 0.85, 0.35, 0.55, 0.75, 0.65, 0.05, 0.00, "Alpha can be high while the treatment effect varies across learners.",
  "recognition_alpha_low_effect_stable", "Low-alpha recognition, stable effect", 1.00, 0.25, 0.25, 0.15, 0.25, 0.55, 0.05, 0.05, 0.00, "Recognition can have low alpha because of ceiling/guessing, while a uniform condition effect is still estimable.",
  "high_load_memory_moderated", "High load, memory-moderated effect", -1.10, 0.00, 0.65, 0.80, 0.55, 0.55, 0.20, 0.15, 0.65, "High-load learning can yield high alpha because memory aptitude dominates; condition effects should be tested with memory moderation."
)

simulate_counterbalanced <- function(n_person, k_per_condition, scenario) {
  spec <- scenario_specs %>% filter(.data$scenario == !!scenario) %>% slice(1)
  total_words <- 2 * k_per_condition

  participant <- seq_len(n_person)
  list_id <- rep(c(0L, 1L), length.out = n_person)
  memory <- rnorm(n_person)
  proficiency <- rnorm(n_person)
  person_intercept <- spec$person_intercept_sd * proficiency + spec$memory_score_slope * memory + rnorm(n_person, 0, 0.20)
  person_slope <- rnorm(n_person, 0, spec$person_slope_sd) + spec$memory_moderation * memory

  word <- seq_len(total_words)
  word_parity <- word %% 2L
  item_intercept <- rnorm(total_words, 0, spec$item_intercept_sd)
  item_slope <- rnorm(total_words, 0, spec$item_slope_sd)

  dat <- expand_grid(participant = participant, word = word) %>%
    mutate(
      list_id = list_id[participant],
      memory_z = memory[participant],
      proficiency = proficiency[participant],
      condition_num = as.integer((word %% 2L) == list_id),
      condition = factor(if_else(condition_num == 1L, "context", "decontext"), levels = c("decontext", "context")),
      eta = spec$base +
        person_intercept[participant] -
        item_intercept[word] +
        condition_num * (spec$delta + person_slope[participant] + item_slope[word]),
      p_latent = inv_logit(eta),
      p_correct = spec$guessing + (1 - spec$guessing) * p_latent,
      correct = rbinom(n(), 1, p_correct)
    )

  true_effect <- spec$delta + mean(person_slope) + mean(item_slope)

  list(
    dat = dat,
    memory = memory,
    person_slope = person_slope,
    item_slope = item_slope,
    true_effect = true_effect
  )
}

condition_form_alphas <- function(dat) {
  form_rows <- expand_grid(
    list_id = sort(unique(dat$list_id)),
    condition = levels(dat$condition)
  )

  map_dfr(seq_len(nrow(form_rows)), function(i) {
    this_list <- form_rows$list_id[i]
    this_condition <- form_rows$condition[i]
    sub <- dat %>%
      filter(list_id == this_list, condition == this_condition) %>%
      arrange(participant, word)

    n_person <- n_distinct(sub$participant)
    n_word <- n_distinct(sub$word)
    mat <- matrix(sub$correct, nrow = n_person, ncol = n_word, byrow = TRUE)

    alpha_binary(mat) %>%
      mutate(list_id = this_list, condition = this_condition, n_form_person = n_person, n_form_items = n_word, .before = 1)
  })
}

aggregate_effect <- function(dat) {
  means <- dat %>%
    group_by(condition) %>%
    summarise(p = mean(correct), .groups = "drop")

  p_decontext <- means$p[means$condition == "decontext"]
  p_context <- means$p[means$condition == "context"]

  tibble(
    mean_decontext = p_decontext,
    mean_context = p_context,
    observed_diff = p_context - p_decontext,
    observed_logit_diff = qlogis(clip01(p_context)) - qlogis(clip01(p_decontext))
  )
}

effect_projection <- expand_grid(
  scenario = scenario_specs$scenario,
  n_person = c(30, 60, 120, 300, 500, 1000),
  k_per_condition = c(5, 10, 15, 30, 60, 100)
) %>%
  left_join(scenario_specs, by = "scenario") %>%
  mutate(
    total_words = 2 * k_per_condition,
    person_slope_sd_unmodeled = sqrt(person_slope_sd^2 + memory_moderation^2),
    effect_sampling_sd_unmodeled = sqrt(person_slope_sd_unmodeled^2 / n_person + item_slope_sd^2 / total_words),
    effect_sampling_sd_memory_adjusted = sqrt(person_slope_sd^2 / n_person + item_slope_sd^2 / total_words),
    effect_signal_ratio_unmodeled = delta^2 / (delta^2 + effect_sampling_sd_unmodeled^2),
    effect_signal_ratio_memory_adjusted = delta^2 / (delta^2 + effect_sampling_sd_memory_adjusted^2),
    main_bottleneck = case_when(
      (person_slope_sd_unmodeled^2 / n_person) > 1.5 * (item_slope_sd^2 / total_words) ~ "participants",
      (item_slope_sd^2 / total_words) > 1.5 * (person_slope_sd_unmodeled^2 / n_person) ~ "items",
      TRUE ~ "both"
    )
  )

write_csv(effect_projection, file.path(out_dir, "simulation_07_effect_dstudy_projection.csv"))

# -------------------------------------------------------------------------
# Simulation 7A: alpha versus realized treatment-effect stability
# -------------------------------------------------------------------------

n_rep_effect <- as.integer(Sys.getenv("SIM07_EFFECT_REPS", "80"))
effect_grid <- expand_grid(
  rep_id = seq_len(n_rep_effect),
  scenario = scenario_specs$scenario,
  n_person = c(60, 120, 300),
  k_per_condition = c(10, 15, 30, 60)
) %>%
  mutate(row_id = row_number(), .before = 1)

message("Running effect generalizability simulations: ", nrow(effect_grid), " datasets")

effect_raw <- pmap_dfr(effect_grid, function(row_id, rep_id, scenario, n_person, k_per_condition) {
  if (row_id %% 500 == 0) {
    message("  effect dataset ", row_id, " / ", nrow(effect_grid), ": ", scenario, ", N=", n_person, ", items/condition=", k_per_condition)
  }
  sim <- simulate_counterbalanced(n_person, k_per_condition, scenario)
  form_alpha <- condition_form_alphas(sim$dat)
  agg <- aggregate_effect(sim$dat)

  tibble(
    rep_id = rep_id,
    scenario = scenario,
    n_person = n_person,
    k_per_condition = k_per_condition,
    total_words = 2 * k_per_condition,
    true_realized_latent_effect = sim$true_effect,
    alpha_form_median = median(form_alpha$alpha, na.rm = TRUE),
    alpha_form_min = min(form_alpha$alpha, na.rm = TRUE),
    alpha_na_rate = mean(is.na(form_alpha$alpha)),
    zero_var_items_median = median(form_alpha$zero_var_items, na.rm = TRUE),
    person_slope_sample_sd = sd(sim$person_slope),
    item_slope_sample_sd = sd(sim$item_slope)
  ) %>%
    bind_cols(agg)
})

effect_summary <- effect_raw %>%
  group_by(scenario, n_person, k_per_condition, total_words) %>%
  summarise(
    n_rep = n(),
    alpha_median = median(alpha_form_median, na.rm = TRUE),
    alpha_q25 = quantile(alpha_form_median, .25, na.rm = TRUE),
    alpha_q75 = quantile(alpha_form_median, .75, na.rm = TRUE),
    alpha_na_rate = mean(alpha_na_rate > 0),
    mean_decontext = median(mean_decontext, na.rm = TRUE),
    mean_context = median(mean_context, na.rm = TRUE),
    observed_logit_diff_median = median(observed_logit_diff, na.rm = TRUE),
    true_effect_median = median(true_realized_latent_effect, na.rm = TRUE),
    true_effect_sd = sd(true_realized_latent_effect, na.rm = TRUE),
    true_effect_rmse_from_delta = sqrt(mean((true_realized_latent_effect - scenario_specs$delta[match(scenario, scenario_specs$scenario)])^2, na.rm = TRUE)),
    .groups = "drop"
  ) %>%
  left_join(scenario_specs %>% select(scenario, scenario_label, delta, interpretation), by = "scenario") %>%
  left_join(
    effect_projection %>%
      select(scenario, n_person, k_per_condition, effect_sampling_sd_unmodeled, effect_sampling_sd_memory_adjusted, main_bottleneck),
    by = c("scenario", "n_person", "k_per_condition")
  ) %>%
  arrange(scenario, n_person, k_per_condition)

write_csv(effect_raw, file.path(out_dir, "simulation_07_effect_generalizability_raw.csv"))
write_csv(effect_summary, file.path(out_dir, "simulation_07_effect_generalizability_summary.csv"))

# -------------------------------------------------------------------------
# Simulation 7B: selected GLMMs, with and without memory moderation
# -------------------------------------------------------------------------

glmm_r2_manual <- function(fit) {
  x <- model.matrix(fit)
  beta <- fixef(fit)
  fixed_lp <- as.vector(x %*% beta)
  var_fixed <- stats::var(fixed_lp)
  vc <- as.data.frame(VarCorr(fit))
  var_random <- sum(vc$vcov, na.rm = TRUE)
  var_distribution <- pi^2 / 3
  denom <- var_fixed + var_random + var_distribution

  tibble(
    r2_marginal = var_fixed / denom,
    r2_conditional = (var_fixed + var_random) / denom,
    var_random = var_random,
    var_distribution = var_distribution
  )
}

fit_selected_glmms <- function(dat) {
  dat <- dat %>%
    mutate(
      participant = factor(participant),
      word = factor(word),
      condition = factor(condition, levels = c("decontext", "context"))
    )

  fit_base <- tryCatch({
    suppressWarnings(glmer(
      correct ~ condition + (1 | participant) + (1 | word),
      data = dat,
      family = binomial,
      nAGQ = 0,
      control = glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 15000))
    ))
  }, error = function(e) e)

  fit_mem <- tryCatch({
    suppressWarnings(glmer(
      correct ~ condition * memory_z + (1 | participant) + (1 | word),
      data = dat,
      family = binomial,
      nAGQ = 0,
      control = glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 15000))
    ))
  }, error = function(e) e)

  extract <- function(fit, model) {
    if (inherits(fit, "error")) {
      return(tibble(
        model = model,
        beta_condition = NA_real_,
        p_condition = NA_real_,
        beta_memory_interaction = NA_real_,
        p_memory_interaction = NA_real_,
        r2_marginal = NA_real_,
        r2_conditional = NA_real_,
        var_participant = NA_real_,
        var_word = NA_real_,
        converged = FALSE,
        error = conditionMessage(fit)
      ))
    }

    coefs <- summary(fit)$coefficients
    vc <- as.data.frame(VarCorr(fit))
    r2 <- glmm_r2_manual(fit)

    beta_int <- if ("conditioncontext:memory_z" %in% rownames(coefs)) unname(coefs["conditioncontext:memory_z", "Estimate"]) else NA_real_
    p_int <- if ("conditioncontext:memory_z" %in% rownames(coefs)) unname(coefs["conditioncontext:memory_z", "Pr(>|z|)"]) else NA_real_

    r2 %>%
      transmute(
        model = model,
        beta_condition = unname(coefs["conditioncontext", "Estimate"]),
        p_condition = unname(coefs["conditioncontext", "Pr(>|z|)"]),
        beta_memory_interaction = beta_int,
        p_memory_interaction = p_int,
        r2_marginal = r2_marginal,
        r2_conditional = r2_conditional,
        var_participant = sum(vc$vcov[vc$grp == "participant"], na.rm = TRUE),
        var_word = sum(vc$vcov[vc$grp == "word"], na.rm = TRUE),
        converged = isTRUE(is.null(fit@optinfo$conv$lme4$messages)),
        error = NA_character_
      )
  }

  bind_rows(
    extract(fit_base, "base_condition"),
    extract(fit_mem, "condition_by_memory")
  )
}

n_rep_glmm <- as.integer(Sys.getenv("SIM07_GLMM_REPS", "15"))
glmm_grid <- expand_grid(
  rep_id = seq_len(n_rep_glmm),
  scenario = scenario_specs$scenario,
  n_person = c(120, 300),
  k_per_condition = c(15, 30)
) %>%
  mutate(row_id = row_number(), .before = 1)

message("Running selected GLMM simulations: ", nrow(glmm_grid), " datasets x 2 models")

glmm_raw <- pmap_dfr(glmm_grid, function(row_id, rep_id, scenario, n_person, k_per_condition) {
  if (row_id %% 50 == 0) {
    message("  GLMM dataset ", row_id, " / ", nrow(glmm_grid), ": ", scenario, ", N=", n_person, ", items/condition=", k_per_condition)
  }
  sim <- simulate_counterbalanced(n_person, k_per_condition, scenario)
  agg <- aggregate_effect(sim$dat)
  fit_selected_glmms(sim$dat) %>%
    mutate(
      rep_id = rep_id,
      scenario = scenario,
      n_person = n_person,
      k_per_condition = k_per_condition,
      total_words = 2 * k_per_condition,
      true_realized_latent_effect = sim$true_effect,
      .before = 1
    ) %>%
    bind_cols(agg[rep(1, nrow(.)), ])
})

glmm_summary <- glmm_raw %>%
  group_by(scenario, n_person, k_per_condition, total_words, model) %>%
  summarise(
    n_rep = n(),
    estimable_rate = mean(!is.na(beta_condition)),
    sig_rate = mean(p_condition < .05, na.rm = TRUE),
    condition_beta_median = median(beta_condition, na.rm = TRUE),
    memory_interaction_beta_median = median(beta_memory_interaction, na.rm = TRUE),
    memory_interaction_sig_rate = mean(p_memory_interaction < .05, na.rm = TRUE),
    r2_marginal_median = median(r2_marginal, na.rm = TRUE),
    r2_conditional_median = median(r2_conditional, na.rm = TRUE),
    var_participant_median = median(var_participant, na.rm = TRUE),
    var_word_median = median(var_word, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  left_join(scenario_specs %>% select(scenario, scenario_label, delta, interpretation), by = "scenario") %>%
  arrange(scenario, n_person, k_per_condition, model)

write_csv(glmm_raw, file.path(out_dir, "simulation_07_effect_glmm_raw.csv"))
write_csv(glmm_summary, file.path(out_dir, "simulation_07_effect_glmm_summary.csv"))

# -------------------------------------------------------------------------
# Figures
# -------------------------------------------------------------------------

p_dstudy <- effect_projection %>%
  filter(n_person %in% c(60, 120, 300, 1000), k_per_condition %in% c(5, 10, 15, 30, 60, 100)) %>%
  mutate(scenario_label = factor(scenario_label, levels = scenario_specs$scenario_label)) %>%
  ggplot(aes(x = k_per_condition, y = effect_sampling_sd_unmodeled, color = factor(n_person), group = n_person)) +
  geom_hline(yintercept = c(.10, .20, .30), linetype = 2, color = "grey65") +
  geom_line(linewidth = .8) +
  geom_point(size = 1.8) +
  facet_wrap(~scenario_label, scales = "free_y") +
  scale_x_continuous(breaks = c(5, 10, 15, 30, 60, 100)) +
  labs(
    x = "Items per condition",
    y = "Projected sampling SD of latent condition effect",
    color = "Participants"
  ) +
  theme_bw(base_size = 10) +
  theme(legend.position = "bottom")

ggsave(file.path(fig_dir, "simulation_07_effect_dstudy_projection.png"), p_dstudy, width = 13, height = 7.5, dpi = 220)

p_alpha_effect <- effect_summary %>%
  filter(n_person == 120) %>%
  mutate(scenario_label = factor(scenario_label, levels = scenario_specs$scenario_label)) %>%
  ggplot(aes(x = alpha_median, y = true_effect_sd, color = factor(k_per_condition))) +
  geom_point(size = 2) +
  facet_wrap(~scenario_label, scales = "free") +
  labs(
    x = "Median condition-form alpha/KR-20",
    y = "SD of sampled latent treatment effect",
    color = "Items per condition"
  ) +
  theme_bw(base_size = 10) +
  theme(legend.position = "bottom")

ggsave(file.path(fig_dir, "simulation_07_alpha_vs_effect_stability.png"), p_alpha_effect, width = 13, height = 7, dpi = 220)

p_bottleneck <- effect_projection %>%
  filter(n_person %in% c(60, 120, 300, 1000), k_per_condition %in% c(10, 15, 30, 60)) %>%
  count(scenario_label, n_person, main_bottleneck) %>%
  ggplot(aes(x = factor(n_person), y = n, fill = main_bottleneck)) +
  geom_col(position = "fill") +
  facet_wrap(~scenario_label) +
  labs(
    x = "Participants",
    y = "Share of item-count settings",
    fill = "Bottleneck"
  ) +
  theme_bw(base_size = 10) +
  theme(legend.position = "bottom")

ggsave(file.path(fig_dir, "simulation_07_generalizability_bottleneck.png"), p_bottleneck, width = 12, height = 6.5, dpi = 220)

p_glmm <- glmm_summary %>%
  mutate(
    scenario_label = factor(scenario_label, levels = scenario_specs$scenario_label),
    model = recode(model, base_condition = "Condition only", condition_by_memory = "Condition x memory")
  ) %>%
  ggplot(aes(x = factor(k_per_condition), y = r2_marginal_median, color = model, group = model)) +
  geom_line(linewidth = .8) +
  geom_point(size = 1.8) +
  facet_grid(n_person ~ scenario_label, labeller = label_both) +
  labs(
    x = "Items per condition",
    y = "Median marginal R2",
    color = "Model"
  ) +
  theme_bw(base_size = 10) +
  theme(legend.position = "bottom")

ggsave(file.path(fig_dir, "simulation_07_glmm_memory_r2.png"), p_glmm, width = 14, height = 7.5, dpi = 220)

# -------------------------------------------------------------------------
# Report
# -------------------------------------------------------------------------

fmt <- function(x, digits = 3) {
  ifelse(is.na(x), "NA", formatC(x, digits = digits, format = "f"))
}

md_table <- function(df) {
  table_lines <- capture.output(write.table(df, sep = " | ", row.names = FALSE, quote = FALSE))
  header <- table_lines[1]
  divider <- paste(rep("---", ncol(df)), collapse = " | ")
  paste(c(header, divider, table_lines[-1]), collapse = "\n")
}

effect_md <- effect_summary %>%
  filter(n_person == 120, k_per_condition %in% c(15, 30, 60)) %>%
  transmute(
    scenario = scenario_label,
    items_per_condition = k_per_condition,
    alpha = fmt(alpha_median),
    observed_logit_diff = fmt(observed_logit_diff_median),
    latent_effect_sd = fmt(true_effect_sd),
    projected_effect_sd = fmt(effect_sampling_sd_unmodeled),
    bottleneck = main_bottleneck
  )

projection_md <- effect_projection %>%
  filter(n_person %in% c(120, 300), k_per_condition %in% c(15, 30, 60)) %>%
  select(scenario_label, n_person, k_per_condition, effect_sampling_sd_unmodeled, effect_sampling_sd_memory_adjusted, main_bottleneck) %>%
  transmute(
    scenario = scenario_label,
    participants = n_person,
    items_per_condition = k_per_condition,
    SD_unmodeled = fmt(effect_sampling_sd_unmodeled),
    SD_memory_adjusted = fmt(effect_sampling_sd_memory_adjusted),
    bottleneck = main_bottleneck
  )

glmm_md <- glmm_summary %>%
  filter(n_person == 120, k_per_condition == 30) %>%
  transmute(
    scenario = scenario_label,
    model = recode(model, base_condition = "condition", condition_by_memory = "condition*memory"),
    sig_rate = fmt(sig_rate),
    beta_condition = fmt(condition_beta_median),
    beta_condition_memory = fmt(memory_interaction_beta_median),
    memory_interaction_sig = fmt(memory_interaction_sig_rate),
    R2_marginal = fmt(r2_marginal_median),
    R2_conditional = fmt(r2_conditional_median)
  )

report_lines <- c(
  "# 介入効果そのものの一般化可能性: Alphaでは見えないもの",
  "",
  paste0("生成日時: ", Sys.time()),
  "",
  "## 目的",
  "",
  "L2語彙介入研究で問題になるのは、合計点の内的一貫性だけでなく、Condition effectが参加者サンプルと語彙項目サンプルを越えてどれだけ一般化できるかである。ここでは、counterbalanced within-participant designを想定し、alpha/KR-20、観測条件差、GLMM R2、D-study風の効果一般化可能性を比較した。",
  "",
  "## シナリオ",
  "",
  "- High alpha, stable effect: alphaも条件効果も安定する基準ケース。",
  "- High alpha, item-sensitive effect: alphaは高いが、どの語を選んだかで条件効果が変わる。",
  "- High alpha, person-sensitive effect: alphaは高いが、どの学習者を抽出したかで条件効果が変わる。",
  "- Low-alpha recognition, stable effect: recognitionの天井・推測でalphaは低いが、条件効果は均一。",
  "- High load, memory-moderated effect: 高負荷学習でalphaは高くなりやすいが、効果が記憶力に依存する。",
  "",
  "## N=120でのalphaと効果安定性",
  "",
  md_table(effect_md),
  "",
  "## 参加者数と項目数を分けたD-study風投影",
  "",
  md_table(projection_md),
  "",
  "## N=120・30項目/条件でのGLMM",
  "",
  md_table(glmm_md),
  "",
  "## 解釈",
  "",
  "- Alpha/KR-20が高いことは、条件効果が項目サンプルや参加者サンプルを越えて安定することを保証しない。",
  "- item-sensitiveな介入では、参加者数を増やしても、語彙項目数または項目のカウンターバランスを増やさない限り、効果の一般化可能性は改善しにくい。",
  "- person-sensitiveまたはmemory-moderatedな介入では、項目数だけ増やしても不十分で、参加者数、適性測定、Condition × aptitude interactionが重要になる。",
  "- recognitionのようにalphaが低く出やすいテストでも、項目レベルGLMMで均一な条件効果を直接モデル化できるなら、alphaの低さだけで介入効果分析を否定する必要はない。",
  "- GLMMのmarginal R2は、固定効果モデルがどれだけ説明したかを示す。memory moderationを入れてR2が上がる場合、それは単なる信頼性改善ではなく、推定対象が「平均介入効果」から「記憶力で条件づけられた介入効果」に変わったことを意味する。",
  "- D-studyは、合計点だけでなく介入効果にも使える。ただしその場合は、person random slope、item random slope、item-by-condition variabilityを分けて考える必要がある。",
  "",
  "## 実務上の判断",
  "",
  "1. 個人得点を尺度として使う研究なら、サブテスト別alpha/KR-20またはIRT reliabilityを報告する。",
  "2. 介入効果が主目的なら、alphaは補助に留め、GLMM/IRTで参加者・項目・必要ならランダムスロープを報告する。",
  "3. 語の種類によって効果が変わる理論なら、項目数とitem-level moderatorを増やす。",
  "4. 学習者適性によって効果が変わる理論なら、参加者数とaptitude measureを増やす。",
  "5. 5分で100語のような高負荷条件では、高alphaをよい知らせとしてだけ扱わず、記憶力依存・構成概念の変化を検討する。",
  "",
  "## 出力ファイル",
  "",
  "- `outputs/simulation_07_effect_dstudy_projection.csv`",
  "- `outputs/simulation_07_effect_generalizability_summary.csv`",
  "- `outputs/simulation_07_effect_glmm_summary.csv`",
  "- `outputs/figures/simulation_07_effect_dstudy_projection.png`",
  "- `outputs/figures/simulation_07_alpha_vs_effect_stability.png`",
  "- `outputs/figures/simulation_07_generalizability_bottleneck.png`",
  "- `outputs/figures/simulation_07_glmm_memory_r2.png`"
)

writeLines(report_lines, file.path(out_dir, "simulation_07_effect_generalizability_report_20260628.md"))

write_session_info("simulation_07_effect_generalizability", out_dir)
message("Done. Outputs written to: ", normalizePath(out_dir))
