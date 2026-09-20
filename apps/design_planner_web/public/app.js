(function initializeDesignAuditApp() {
  "use strict";

  const core = window.DesignAudit;
  const claimMath = window.ClaimMath;
  const fixturePayload = window.DesignAuditFixtures;
  const registry = window.DesignAuditRegistry;
  const targetRegistry = window.InferentialTargetRegistry;
  const referenceGridRegistry = window.ReferenceGridRegistry;
  const decisionRules = window.DecisionRulesRegistry;
  if (!core || !claimMath || !fixturePayload || !registry || !targetRegistry ||
      !referenceGridRegistry || !decisionRules) {
    throw new Error("Design-audit or claim-routing assets failed to load.");
  }
  if (targetRegistry.schema_version !== "1.0.0" || targetRegistry.branches.length !== 4) {
    throw new Error("Inferential-target registry contract mismatch.");
  }
  if (referenceGridRegistry.schema_version !== "1.0.0" ||
      referenceGridRegistry.families.length !== 2 ||
      referenceGridRegistry.families.some(family => family.lookup_mode !== "exact_only")) {
    throw new Error("Reference-grid registry contract mismatch.");
  }
  if (decisionRules.schema_version !== "1.0.0" ||
      decisionRules.pathways.map(pathway => pathway.id).join("|") !==
        "browser_static|short_r_api|offline_async") {
    throw new Error("Decision-rules contract mismatch.");
  }

  const templateLabels = {
    hierarchical_crossed_validated: "Hierarchical + crossed facets",
    one_class_per_condition: "Failure: one class per condition",
    two_facet_counterbalanced: "Eligible shape: participant × item",
    spatial_prefecture: "Out of scope: spatial prefectures",
    slope_without_within_facet_variation: "Failure: slope without within-facet variation",
    omitted_item_slope: "Fragile: omitted item slope",
    cyclic_hierarchy: "Failure: cyclic nesting graph"
  };
  const templateDescriptions = {
    hierarchical_crossed_validated: "Five explicitly nested/crossed facets. Its fixture validation ID is intentionally ignored because the public registry is empty.",
    one_class_per_condition: "Many learner rows cannot repair the absence of independent assignment replication.",
    two_facet_counterbalanced: "A two-condition counterbalanced participant × item design with both condition slopes. It is eligible for a closed-form sensitivity projection, but remains unvalidated.",
    spatial_prefecture: "Spatial dependence is separated from identification and routed outside this lme4-based model class.",
    slope_without_within_facet_variation: "A condition slope cannot be estimated where condition never changes within that facet.",
    omitted_item_slope: "The mean effect is structurally estimable, but the word-generalization claim is narrowed.",
    cyclic_hierarchy: "Parent links must form an acyclic hierarchy; crossing is represented with a blank parent."
  };
  const stateDescriptions = {
    "Not identifiable": "A structural conflict prevents the requested condition effect or random-slope structure from being identified. Numerical guidance is stopped.",
    "Outside supported model class": "The structure may be scientifically identifiable, but this lme4-based audit cannot represent its dependence. Use a specialist model before requesting numbers.",
    "Estimable but fragile": "No fatal structural conflict was found, but the design is unregistered or carries a warning. Treat any formula as a sensitivity-analysis starting point.",
    "Within validated envelope": "The exact registered design and parameter envelope has passed the required performance review. This state cannot be selected by user input alone."
  };
  const dependenceOptions = [
    ["iid", "IID / exchangeable"],
    ["diag", "Diagonal"],
    ["us", "Unstructured"],
    ["cs", "Compound symmetry"],
    ["ar1", "AR(1)"],
    ["spatial", "Spatial (out of scope)"],
    ["multiple_membership", "Multiple membership (out of scope)"],
    ["custom_residual", "Custom residual (out of scope)"],
    ["informative_cluster_size", "Informative cluster size (out of scope)"]
  ];
  const slopeOptions = [
    ["none", "None"],
    ["diag", "diag"],
    ["us", "us"],
    ["cs", "cs"],
    ["ar1", "ar1"]
  ];
  const modelRoleOptions = [
    ["random", "Random"],
    ["fixed", "Fixed"],
    ["omitted", "Omitted"]
  ];

  const byId = id => document.getElementById(id);
  const elements = {
    form: byId("design-form"),
    template: byId("template-select"),
    templateDescription: byId("template-description"),
    mode: byId("assignment-mode"),
    conditionLevels: byId("condition-levels"),
    assignmentFacets: byId("assignment-facets"),
    samplingFacets: byId("sampling-facets"),
    replication: byId("assignment-replication"),
    observation: byId("observation-unit"),
    analysis: byId("analysis-unit"),
    facetRows: byId("facet-rows"),
    addFacet: byId("add-facet"),
    evaluate: byId("evaluate-design"),
    reset: byId("reset-template"),
    stateCard: byId("state-card"),
    stateTitle: byId("result-title"),
    stateDescription: byId("state-description"),
    issueCount: byId("issue-count"),
    issueList: byId("issue-list"),
    formula: byId("formula-output"),
    generalizes: byId("generalizes-output"),
    notGeneralizes: byId("not-generalizes-output"),
    payload: byId("payload-output"),
    copy: byId("copy-payload"),
    download: byId("download-payload"),
    logicVersion: byId("logic-version"),
    decisionVersion: byId("decision-version"),
    registryVersion: byId("registry-version"),
    registryCount: byId("registry-count"),
    claimOptions: byId("claim-options"),
    routeBranch: byId("route-branch"),
    routeQuestion: byId("route-question"),
    routeTarget: byId("route-target"),
    alignedEvidence: byId("aligned-evidence"),
    minimumReporting: byId("minimum-reporting"),
    notLicense: byId("not-license"),
    routeGate: byId("route-gate"),
    routeGateTitle: byId("route-gate-title"),
    routeGateMessage: byId("route-gate-message"),
    alphaTool: byId("alpha-tool"),
    alphaK: byId("alpha-k"),
    alphaRbar: byId("alpha-rbar"),
    alphaPbar: byId("alpha-pbar"),
    alphaHighLoad: byId("alpha-high-load"),
    alphaValue: byId("alpha-value"),
    alphaNotes: byId("alpha-notes"),
    effectTool: byId("effect-tool"),
    effectN: byId("effect-n"),
    effectK: byId("effect-k"),
    effectPersonSd: byId("effect-person-sd"),
    effectItemSd: byId("effect-item-sd"),
    effectMemory: byId("effect-memory"),
    effectMemoryAdjusted: byId("effect-memory-adjusted"),
    effectValue: byId("effect-value"),
    effectBottleneck: byId("effect-bottleneck"),
    effectPersonComponent: byId("effect-person-component"),
    effectItemComponent: byId("effect-item-component"),
    effectComparison: byId("effect-comparison"),
    effectComparisonRows: byId("effect-comparison-rows"),
    effectInterpretation: byId("effect-interpretation"),
    effectNextStep: byId("effect-next-step"),
    effectError: byId("effect-error"),
    referenceGridTool: byId("reference-grid-tool"),
    gridFamily: byId("grid-family"),
    gridScenario: byId("grid-scenario"),
    gridN: byId("grid-n"),
    gridScoringField: byId("grid-scoring-field"),
    gridScoring: byId("grid-scoring"),
    gridKField: byId("grid-k-field"),
    gridK: byId("grid-k"),
    gridModelField: byId("grid-model-field"),
    gridModel: byId("grid-model"),
    gridRowTitle: byId("grid-row-title"),
    referenceMetrics: byId("reference-metrics"),
    referenceLimitations: byId("reference-limitations"),
    gridDesignNote: byId("grid-design-note"),
    qualitativeTool: byId("qualitative-tool"),
    qualitativeToolMessage: byId("qualitative-tool-message"),
    reportingStarter: byId("reporting-starter")
  };

  const clone = value => typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
  const fixtures = fixturePayload.fixtures;
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const validatedIds = registry.validated_envelopes.map(entry =>
    typeof entry === "string" ? entry : entry.id
  );
  const branchById = new Map(targetRegistry.branches.map(branch => [branch.id, branch]));
  const gridFamilyById = new Map(referenceGridRegistry.families.map(family => [family.id, family]));
  let currentBranchId = targetRegistry.branches[0].id;
  let currentAudit = null;
  let currentRoute = null;
  let evaluationTimer = null;
  let plannerStep = 0;
  let curvePoints = [];
  const assumptionFields = ["person_slope_sd", "item_slope_sd", "memory_moderation", "memory_adjusted"];
  let heldAssumptions = [];
  let nextAssumptionSet = 1;
  // count * (100 + increase) stays an exact integer throughout the 0–200% curve.
  const maxPlanCount = Math.floor(Number.MAX_SAFE_INTEGER / 300);
  for (const input of [elements.effectN, elements.effectK]) input.max = maxPlanCount;
  const formatSd = (value, digits = 4) => value !== 0 && (value < 10 ** -digits || value >= 1e4)
    ? value.toExponential(digits - 1) : value.toFixed(digits);

  function updatePlannerHeadings() {
    const offset = document.body.dataset.mode === "guided" ? 2 : 0;
    for (const heading of elements.effectTool.querySelectorAll("h4, h5, h6")) {
      heading.setAttribute("aria-level", Number(heading.tagName.slice(1)) - offset);
    }
  }

  function setPlannerStep(step, focus = false) {
    updatePlannerHeadings();
    const valid = currentRoute?.calculation?.status === "computed_sensitivity";
    plannerStep = valid ? step : 0;
    for (const panel of elements.effectTool.querySelectorAll("[data-plan-panel]")) {
      panel.hidden = Number(panel.dataset.planPanel) !== plannerStep;
    }
    for (const button of elements.effectTool.querySelectorAll("[data-plan-step]")) {
      button.disabled = Number(button.dataset.planStep) > 0 && !valid;
      if (Number(button.dataset.planStep) === plannerStep) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    byId("reporting-panel").hidden = !elements.effectTool.hidden && plannerStep !== 2;
    if (!elements.effectTool.hidden && plannerStep === 1 && valid) {
      renderEffectCurve(currentRoute.calculation.inputs, currentRoute.calculation.result);
    }
    const heading = byId(["effect-tool-title", "comparison-title", "export-title"][plannerStep]);
    elements.effectTool.setAttribute("aria-labelledby", heading.id);
    if (document.body.dataset.mode === "guided") document.querySelector(".skip-link").href = "#" + heading.id;
    if (focus) {
      heading.focus({ preventScroll: true });
      byId("planner-steps").scrollIntoView?.({ block: "start" });
    }
  }

  function showMode(mode) {
    document.body.dataset.mode = mode;
    updatePlannerHeadings();
    byId("planning-entry").hidden = mode !== "overview";
    byId("claim-router").hidden = mode === "overview";
    byId("design-details").hidden = mode === "overview";
    byId("show-overview").hidden = mode === "overview";
    byId("claim-router").setAttribute("aria-label", mode === "guided" ? "Study size comparison" : "Research tools");
    byId("claim-router").removeAttribute("aria-labelledby");
    document.querySelector(".skip-link").href = mode === "overview" ? "#planning-entry-title" : mode === "advanced" ? "#claim-router-title" : "#effect-tool-title";
  }

  function replaceList(element, items) {
    element.replaceChildren(...items.map(item => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
  }

  function makeClaimOption(branch, selected) {
    const label = document.createElement("label");
    label.className = "claim-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "claim-target";
    radio.value = branch.id;
    radio.checked = selected;
    const copy = document.createElement("span");
    copy.className = "claim-option-copy";
    const number = document.createElement("span");
    number.className = "claim-option-number";
    number.textContent = `Branch ${branch.number} · ${branch.label}`;
    const question = document.createElement("span");
    question.className = "claim-option-question";
    question.textContent = branch.question;
    const target = document.createElement("span");
    target.className = "claim-option-label";
    target.textContent = branch.inferential_target;
    copy.append(number, question, target);
    label.append(radio, copy);
    return label;
  }

  function numberFrom(element) {
    const value = element.valueAsNumber;
    // Browser number inputs can turn a nonzero string such as 1e-400 into zero.
    return value === 0 && /[1-9]/.test(element.value.split(/[eE]/)[0]) ? NaN : value;
  }

  function syncPayload() {
    if (!currentAudit) return;
    currentAudit.inferential_route = currentRoute;
    elements.payload.textContent = JSON.stringify(currentAudit, null, 2);
  }

  function renderAlphaProjection() {
    for (const field of [elements.alphaK, elements.alphaRbar, elements.alphaPbar]) {
      field.removeAttribute("aria-invalid");
    }
    const inputs = {
      k: numberFrom(elements.alphaK),
      r_bar: numberFrom(elements.alphaRbar),
      p_bar: numberFrom(elements.alphaPbar),
      high_load: elements.alphaHighLoad.checked
    };
    try {
      const result = claimMath.alphaExpectation(inputs);
      elements.alphaValue.textContent = result.alpha.toFixed(3);
      const notes = [
        `Identity used: α = k r̄ / [1 + (k − 1) r̄], with k = ${inputs.k} and r̄ = ${inputs.r_bar.toFixed(2)}.`
      ];
      notes.push(result.floor_ceiling_flag
        ? `Floor/ceiling caution: mean accuracy ${inputs.p_bar.toFixed(2)} lies outside the .15–.85 diagnostic band; realized alpha can diverge sharply from this expectation.`
        : `Mean accuracy ${inputs.p_bar.toFixed(2)} does not trigger the .15–.85 floor/ceiling diagnostic, but the score distribution still must be reported.`);
      if (result.memory_sorting_flag) {
        notes.push("High-load caution: a very high expected coefficient may reflect sorting by memory capacity rather than stronger construct alignment.");
      } else if (inputs.high_load) {
        notes.push("High load is declared; report exposure time per word and check dependence on memory or aptitude even though the > .90 caution did not trigger.");
      }
      replaceList(elements.alphaNotes, notes);
      return { status: "computed_sensitivity", inputs, result };
    } catch (error) {
      elements.alphaValue.textContent = "Invalid";
      replaceList(elements.alphaNotes, [error.message]);
      for (const field of [elements.alphaK, elements.alphaRbar, elements.alphaPbar]) {
        if (!field.checkValidity() || !Number.isFinite(numberFrom(field))) {
          field.setAttribute("aria-invalid", "true");
        }
      }
      return { status: "invalid_input", inputs, error: error.message };
    }
  }

  function conditionAuditGate() {
    if (!currentAudit) {
      return { status: "blocked", title: "Design audit required", message: "Evaluate assignment and facet structure before interpreting a condition effect." };
    }
    const result = currentAudit.result;
    if (!result.can_compute) {
      return {
        status: "blocked",
        title: `Blocked by design audit: ${result.state}`,
        message: "The condition-effect route cannot advance to a formula or numerical result until the structural or model-scope reasons below are resolved."
      };
    }
    return {
      status: "caution",
      title: `Structure passes the gate as ${result.state}`,
      message: "A formula can be discussed, but the empty validation registry means this design is not numerically certified. Report every limitation attached to the current audit."
    };
  }

  function effectProjectionGate() {
    const base = conditionAuditGate();
    if (base.status === "blocked") return base;
    const design = currentAudit.design;
    const facetById = new Map(design.facets.map(facet => [facet.id.toLowerCase(), facet]));
    const participant = facetById.get("participant");
    const item = facetById.get("item");
    const slopeIds = design.facets
      .filter(facet => facet.model_role === "random" && facet.slope !== "none")
      .map(facet => facet.id.toLowerCase())
      .sort();
    const targetIds = design.facets
      .filter(facet => facet.generalization_target)
      .map(facet => facet.id.toLowerCase())
      .sort();
    const assignmentIds = design.units.assignment.map(id => id.toLowerCase()).sort();
    const exactPair = values => values.length === 2 && values[0] === "item" && values[1] === "participant";
    const facetsEligible = [participant, item].every(facet => facet &&
      facet.condition_varies_within && facet.model_role === "random" && facet.slope !== "none");
    const eligible = design.assignment.mode === "crossed_counterbalance" &&
      design.assignment.condition_levels === 2 && exactPair(assignmentIds) &&
      exactPair(slopeIds) && exactPair(targetIds) && facetsEligible;
    if (!eligible) {
      return {
        status: "blocked",
        title: "Closed-form projection shape does not match",
        message: "This projection requires exactly two crossed assignment and generalization facets named participant and item, two conditions, within-facet condition variation, and both random slopes. Extra class/school/prefecture slopes require a new offline projection or simulation."
      };
    }
    return {
      status: "caution",
      title: "Two-facet sensitivity projection available",
      message: "The structural shape matches the published participant × item identity. Typed slope SDs remain assumptions, and the empty registry prevents a validated-envelope claim."
    };
  }

  function clearEffectResults() {
    elements.effectComparison.hidden = true;
    elements.effectComparisonRows.replaceChildren();
    elements.effectInterpretation.textContent = "";
    byId("effect-takeaway").textContent = "";
    byId("effect-variance-explanation").textContent = "";
    byId("comparison-selection").textContent = "";
    elements.effectNextStep.textContent = "";
    elements.effectError.hidden = true;
    byId("download-effect-r").disabled = true;
    byId("effect-r-code").textContent = "";
    byId("r-download-status").textContent = "";
    byId("plan-count-summary").textContent = "";
    byId("assumption-summary").textContent = "";
    byId("keep-effect-assumptions").disabled = true;
    byId("assumption-set-cards").replaceChildren();
    byId("assumption-comparison-summary").textContent = "";
    byId("assumption-common-counts").textContent = "";
    byId("assumption-export-note").textContent = "";
    curvePoints = [];
  }

  function renderEffectProjection(gate) {
    const allowed = gate.status !== "blocked";
    // Keep the comparison in the layout while updating it. Hiding it before
    // reading the chart width collapses the page and resets the user's scroll.
    elements.effectError.hidden = true;
    byId("r-download-status").textContent = "";
    for (const input of elements.effectTool.querySelectorAll("input")) {
      input.removeAttribute("aria-invalid");
      const description = (input.getAttribute("aria-describedby") || "").split(" ").filter(id => id && id !== "effect-error").join(" ");
      if (description) input.setAttribute("aria-describedby", description);
      else input.removeAttribute("aria-describedby");
    }
    for (const input of elements.effectTool.querySelectorAll("input")) input.disabled = !allowed;
    if (!allowed) {
      clearEffectResults();
      elements.effectValue.textContent = "Blocked";
      elements.effectBottleneck.textContent = "—";
      elements.effectPersonComponent.textContent = "—";
      elements.effectItemComponent.textContent = "—";
      return { status: "blocked_by_design_gate" };
    }
    const inputs = {
      n_person: numberFrom(elements.effectN),
      k_per_condition: numberFrom(elements.effectK),
      person_slope_sd: numberFrom(elements.effectPersonSd),
      item_slope_sd: numberFrom(elements.effectItemSd),
      memory_moderation: numberFrom(elements.effectMemory),
      memory_adjusted: elements.effectMemoryAdjusted.checked
    };
    try {
      if (inputs.n_person > maxPlanCount || inputs.k_per_condition > maxPlanCount) {
        throw new RangeError(`Use counts no greater than ${maxPlanCount} so the full expansion curve can be calculated exactly.`);
      }
      const result = claimMath.effectProjection(inputs);
      elements.effectValue.textContent = formatSd(result.sampling_sd);
      elements.effectBottleneck.textContent = result.bottleneck;
      elements.effectPersonComponent.textContent = result.person_component.toExponential(3);
      elements.effectItemComponent.textContent = result.item_component.toExponential(3);
      const comparison = renderEffectComparison(inputs, result);
      const assumptionComparison = renderAssumptionComparison(inputs);
      byId("plan-count-summary").textContent = `${inputs.n_person} learners · ${2 * inputs.k_per_condition} total words · two conditions`;
      byId("assumption-summary").textContent = `Current assumptions: learner slope SD ${inputs.person_slope_sd}, word slope SD ${inputs.item_slope_sd}; memory variation ${inputs.memory_moderation} (${inputs.memory_adjusted ? "fully accounted for" : "unmodeled"}). The starting values are illustrative. Open the guide above for examples and help choosing values.`;
      byId("effect-r-code").textContent = effectRCode(inputs);
      byId("download-effect-r").disabled = false;
      return { status: "computed_sensitivity", inputs, result, comparison, increase_percent: numberFrom(byId("effect-increase")), assumption_comparison: assumptionComparison };
    } catch (error) {
      clearEffectResults();
      elements.effectValue.textContent = "Invalid";
      elements.effectBottleneck.textContent = "—";
      elements.effectPersonComponent.textContent = "—";
      elements.effectItemComponent.textContent = "—";
      elements.effectError.textContent = error.message;
      elements.effectError.hidden = false;
      for (const input of elements.effectTool.querySelectorAll('input[type="number"]')) {
        if (!Number.isFinite(numberFrom(input)) || !input.checkValidity()) input.setAttribute("aria-invalid", "true");
      }
      const invalidField = elements.effectTool.querySelector('input[aria-invalid="true"]');
      if (invalidField) {
        invalidField.setAttribute("aria-describedby", [invalidField.getAttribute("aria-describedby"), "effect-error"].filter(Boolean).join(" "));
        const label = invalidField.labels[0].querySelector("span").textContent;
        elements.effectError.textContent = invalidField.valueAsNumber === 0 && !Number.isFinite(numberFrom(invalidField))
          ? `${label}: this nonzero value is too small to represent. Use zero only when no variation is assumed.`
          : invalidField.validity.rangeOverflow
          ? `${label}: this count is too large to compare reliably. Use a smaller whole number.`
          : `${label}: enter ${invalidField.step === "1"
            ? "a whole number of at least 1" : "a number of 0 or greater"}.`;
        if (invalidField.closest("details")) invalidField.closest("details").open = true;
      }
      return { status: "invalid_input", inputs, error: error.message };
    }
  }


  function expandedPlan(inputs, increase, facet) {
    const n = facet === "learners" ? Math.ceil(inputs.n_person * (100 + increase) / 100) : inputs.n_person;
    const k = facet === "words" ? Math.ceil(inputs.k_per_condition * (100 + increase) / 100) : inputs.k_per_condition;
    return { n, k, ...claimMath.effectProjection({ ...inputs, n_person: n, k_per_condition: k }) };
  }

  function renderEffectCurve(inputs, baseline) {
    const svg = byId("effect-curve");
    const width = Math.max(280, svg.clientWidth || 640);
    svg.setAttribute("viewBox", `0 0 ${width} 300`);
    svg.dataset.width = width;
    byId("curve-x-title").setAttribute("x", (64 + width - 16) / 2);
    curvePoints = Array.from({ length: 41 }, (_, index) => ({
      increase: index * 5,
      learners: expandedPlan(inputs, index * 5, "learners"),
      words: expandedPlan(inputs, index * 5, "words")
    }));
    const ceiling = baseline.sampling_sd > 0 ? baseline.sampling_sd * 1.1 : 1;
    const y = sd => 244 - sd / ceiling * 220;
    const x = increase => 64 + increase / 200 * (width - 80);
    const grid = byId("curve-grid");
    grid.replaceChildren();
    function svgElement(tag, attributes, text) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      if (text !== undefined) node.textContent = text;
      grid.append(node);
    }
    for (let tick = 0; tick <= 4; tick++) {
      const value = ceiling * tick / 4;
      svgElement("line", { x1: 64, x2: width - 16, y1: y(value), y2: y(value), class: "chart-gridline" });
      svgElement("text", { x: 54, y: y(value) + 4, "text-anchor": "end", class: "axis-tick" }, formatSd(value, 3));
      svgElement("text", { x: x(tick * 50), y: 266, "text-anchor": "middle", class: "axis-tick" }, "+" + tick * 50 + "%");
    }
    for (const [facet, id] of [["learners", "learner-curve"], ["words", "word-curve"]]) {
      byId(id).setAttribute("d", curvePoints.map((point, index) =>
        (index ? "L" : "M") + x(point.increase) + "," + y(point[facet].sampling_sd)
      ).join(" "));
    }
    byId("effect-curve").dataset.ceiling = ceiling;
    const increase = numberFrom(byId("effect-increase"));
    const selected = curvePoints.find(point => point.increase === increase);
    byId("increase-value").textContent = increase + "%";
    byId("effect-increase").setAttribute("aria-valuetext", `${increase}% increase: ${selected.learners.n} learners or ${2 * selected.words.k} total words, with the other count unchanged.`);
    inspectCurve(increase);
  }

  function inspectCurve(increase) {
    const point = curvePoints.find(value => value.increase === increase);
    if (!point) return;
    const x = 64 + increase / 200 * (Number(byId("effect-curve").dataset.width) - 80);
    const ceiling = Number(byId("effect-curve").dataset.ceiling);
    byId("curve-cursor").setAttribute("x1", x);
    byId("curve-cursor").setAttribute("x2", x);
    const selected = increase === numberFrom(byId("effect-increase"));
    byId("curve-preview-label").textContent = (selected ? "Selected" : "Preview") + ": +" + increase + "% in one count";
    for (const [facet, prefix] of [["learners", "learner"], ["words", "word"]]) {
      const plan = point[facet];
      byId(prefix + "-dot").setAttribute("cx", x);
      byId(prefix + "-dot").setAttribute("cy", 244 - plan.sampling_sd / ceiling * 220);
      byId("curve-" + prefix + "-sd").textContent = formatSd(plan.sampling_sd) + " SD";
      byId("curve-" + prefix + "-counts").textContent = plan.n + " learners · " + (2 * plan.k) + " total words";
      const baseline = curvePoints[0].learners.sampling_sd;
      byId("curve-" + prefix + "-reduction").textContent = baseline > 0
        ? ((1 - plan.sampling_sd / baseline) * 100).toFixed(1) + "% lower sampling SD"
        : "SD reduction is undefined";
    }
  }

  function curveIncreaseAt(event) {
    const rect = byId("effect-curve").getBoundingClientRect();
    const width = Number(byId("effect-curve").dataset.width);
    const x = (event.clientX - rect.left) / rect.width * width;
    return Math.round(Math.max(0, Math.min(200, (x - 64) / (width - 80) * 200)) / 5) * 5;
  }

  function effectRCode(inputs) {
    const increase = numberFrom(byId("effect-increase"));
    return [
      "# Vocabulary design planner: reproduce the current sensitivity comparison",
      "# Run with Rscript --vanilla vocabulary-design-sensitivity.R, or source in RStudio.",
      `# Base R only. This script writes/overwrites ${heldAssumptions.length ? "four" : "three"} vocabulary-*.csv/pdf files`,
      "# in the working directory. It does not install packages or use a network.",
      "#",
      "# Scope: exactly two counterbalanced conditions, crossed learners and words,",
      "# with a condition slope for both facets. Counts below are hypothetical;",
      "# they do not replace counts in the separate design-structure audit.",
      "# Variation is on the latent logit scale. Assumptions are not fitted estimates.",
      "# Excludes response-level estimation error and moderator-estimation uncertainty.",
      "# This is NOT fitted-model SE, power, simulation, or design validation.",
      "# Learning time, exposure and the response process are held constant.",
      "# Equal proportional increases do not imply equal costs.",
      "# Claim-math contract: " + claimMath.SCHEMA_VERSION,
      "",
      "# 1. Current inputs (edit these to explore other assumptions)",
      "n_person <- " + inputs.n_person,
      "k_per_condition <- " + inputs.k_per_condition,
      "person_slope_sd <- " + inputs.person_slope_sd,
      "item_slope_sd <- " + inputs.item_slope_sd,
      "memory_moderation <- " + inputs.memory_moderation,
      "memory_adjusted <- " + (inputs.memory_adjusted ? "TRUE" : "FALSE"),
      "increase_percent <- " + increase,
      "",
      "stopifnot(all(is.finite(c(n_person, k_per_condition, person_slope_sd,",
      "                         item_slope_sd, memory_moderation, increase_percent))),",
      `          n_person >= 1, n_person <= ${maxPlanCount}, n_person == floor(n_person),`,
      `          k_per_condition >= 1, k_per_condition <= ${maxPlanCount}, k_per_condition == floor(k_per_condition),`,
      "          person_slope_sd >= 0, item_slope_sd >= 0, memory_moderation >= 0,",
      "          is.logical(memory_adjusted), length(memory_adjusted) == 1L,",
      "          !is.na(memory_adjusted), increase_percent >= 0, increase_percent <= 200)",
      "",
      "# 2. Closed-form projection; total words = 2 * k_per_condition",
      "# Fully accounting for memory removes that component from learner variation.",
      "project_sd <- function(n, k, person = person_slope_sd, word = item_slope_sd,",
      "                       memory = memory_moderation, adjusted = memory_adjusted) {",
      "  person_term <- (person^2 + ifelse(adjusted, 0, memory^2)) / n",
      "  item_term <- word^2 / (2 * k)",
      "  # Reject overflow and subnormal/underflowed positive variance terms.",
      "  stopifnot(all(is.finite(person_term + item_term)),",
      "    all((person == 0 & (adjusted | memory == 0)) | person_term >= .Machine$double.xmin),",
      "    all(word == 0 | item_term >= .Machine$double.xmin))",
      "  sqrt(person_term + item_term)",
      "}",
      "expand_count <- function(count, percent) ceiling(count * (100 + percent) / 100)",
      "baseline_sd <- project_sd(n_person, k_per_condition)",
      "",
      "comparison <- data.frame(",
      '  plan = c("Current plan", "More learners", "More words"),',
      "  learners = c(n_person, expand_count(n_person, increase_percent), n_person),",
      "  words_per_condition = c(k_per_condition, k_per_condition,",
      "                          expand_count(k_per_condition, increase_percent)))",
      "comparison$total_words <- 2 * comparison$words_per_condition",
      "comparison$sampling_sd <- with(comparison, project_sd(learners, words_per_condition))",
      "comparison$sd_reduction <- if (baseline_sd > 0) 1 - comparison$sampling_sd / baseline_sd else NA_real_",
      "stopifnot(all(is.finite(comparison$sampling_sd)))",
      'print(comparison, row.names = FALSE, digits = 8)',
      'write.csv(comparison, "vocabulary-comparison.csv", row.names = FALSE)',
      "",
      "# 3. Sensitivity curves: counts are rounded UP, as in the web interface.",
      "curve <- data.frame(increase_percent = seq(0, 200, by = 5))",
      "curve$learners <- expand_count(n_person, curve$increase_percent)",
      "curve$total_words <- 2 * expand_count(k_per_condition, curve$increase_percent)",
      "curve$sd_more_learners <- project_sd(curve$learners, k_per_condition)",
      "curve$sd_more_words <- project_sd(n_person, curve$total_words / 2)",
      "stopifnot(all(is.finite(curve$sd_more_learners)), all(is.finite(curve$sd_more_words)))",
      'write.csv(curve, "vocabulary-sensitivity-curve.csv", row.names = FALSE)',
      "",
      "# The PDF is a static reproduction of the two browser curves.",
      'pdf("vocabulary-sensitivity.pdf", width = 8, height = 5)',
      "plot(curve$increase_percent, curve$sd_more_learners, type = 'l', lwd = 2,",
      "     col = '#465FD4', ylim = c(0, if (baseline_sd > 0) baseline_sd * 1.1 else 1),",
      '     xlab = "Requested increase in one count (%)", ylab = "Projected sampling SD",',
      '     main = "More learners or more words?")',
      "lines(curve$increase_percent, curve$sd_more_words, col = '#B46632', lty = 2, lwd = 2)",
      "abline(v = increase_percent, col = 'gray60', lty = 3)",
      "points(rep(increase_percent, 2), comparison$sampling_sd[2:3], pch = c(16, 17),",
      "       col = c('#465FD4', '#B46632'))",
      'legend("topright", c("More learners", "More words"),',
      "       col = c('#465FD4', '#B46632'), lty = c(1, 2), lwd = 2, bty = 'n')",
      'mtext("Assumption-based projection; not fitted-model SE or power.", side = 3, cex = 0.8)',
      "invisible(dev.off())",
      "",
      "# If all included variance components are zero, reductions are undefined.",
      "# A zero projected SD does not imply perfect precision.",
      "# Next: repeat with plausible slope SDs, then consider cost, exposure and fatigue.",
      "",
      ...assumptionRCode()
    ].join("\n");
  }

  function effectPlans(inputs, increase) {
    const baseline = claimMath.effectProjection(inputs);
    const expand = n => Math.ceil(n * (100 + increase) / 100);
    return [
      { label: "Current plan", n: inputs.n_person, k: inputs.k_per_condition },
      { label: increase === 100 ? "Double learners" : `More learners (+${increase}%)`, n: expand(inputs.n_person), k: inputs.k_per_condition },
      { label: increase === 100 ? "Double words" : `More words (+${increase}%)`, n: inputs.n_person, k: expand(inputs.k_per_condition) }
    ].map(plan => {
      const projection = claimMath.effectProjection({ ...inputs, n_person: plan.n, k_per_condition: plan.k });
      return { ...plan, sampling_sd: projection.sampling_sd,
        sd_reduction: baseline.sampling_sd > 0 ? 1 - projection.sampling_sd / baseline.sampling_sd : null };
    });
  }

  function expansionChoice(plans, increase) {
    const [baseline, learners, words] = plans;
    if (baseline.sampling_sd === 0) return "zero_variation";
    if (increase === 0) return "no_increase";
    if (Math.abs(learners.sampling_sd - words.sampling_sd) <= baseline.sampling_sd * 1e-10) return "tie";
    return learners.sampling_sd < words.sampling_sd ? "learners" : "words";
  }

  function renderEffectComparison(inputs, baseline) {
    const increase = numberFrom(byId("effect-increase"));
    const plans = effectPlans(inputs, increase);
    const choice = expansionChoice(plans, increase);
    elements.effectComparisonRows.replaceChildren(...plans.map(plan => {
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = plan.label;
      const counts = document.createElement("td");
      counts.textContent = `${plan.n} / ${2 * plan.k}`;
      const sd = document.createElement("td");
      const value = document.createElement("span");
      value.textContent = formatSd(plan.sampling_sd);
      const bar = document.createElement("meter");
      bar.min = 0;
      bar.max = baseline.sampling_sd || 1;
      bar.value = plan.sampling_sd;
      bar.setAttribute("aria-label", `${plan.label}: projected sampling SD ${value.textContent}`);
      sd.append(value, bar);
      const reduction = document.createElement("td");
      reduction.textContent = plan.sd_reduction === null ? "Not defined" : `${(plan.sd_reduction * 100).toFixed(1)}%`;
      row.append(label, counts, sd, reduction);
      return row;
    }));
    const [current, learners, words] = plans;
    let takeaway;
    let answer;
    let varianceExplanation = "";
    if (baseline.sampling_sd === 0) {
      takeaway = "These assumptions do not distinguish the two expansions.";
      answer = "All included effect-variation components are zero. This projection cannot favor either expansion; it does not imply perfect precision or zero model-estimation error.";
    } else {
      const personShare = 100 * baseline.person_component / baseline.sampling_sd ** 2;
      takeaway = choice === "no_increase" ? "No increase is selected."
        : choice === "tie"
        ? "Under these assumptions, both expansions reduce variation equally."
        : choice === "learners"
          ? "Under these assumptions, adding learners reduces variation more."
          : "Under these assumptions, adding words reduces variation more.";
      answer = increase === 0 ? "Both alternatives match the current plan. Move the slider to explore a larger study."
        : `Compared with your current ${current.n} learners and ${2 * current.k} total words, ${learners.n} learners (keeping ${2 * current.k} words) gives ${(100 * learners.sd_reduction).toFixed(1)}% lower sampling SD; ${2 * words.k} words (keeping ${current.n} learners) gives ${(100 * words.sd_reduction).toFixed(1)}% lower sampling SD.`;
      varianceExplanation = `Under these assumptions, learners contribute ${personShare.toFixed(1)}% and words ${(100 - personShare).toFixed(1)}% of the included sampling variance. The current SD is ${formatSd(current.sampling_sd)}; the alternatives give ${formatSd(learners.sampling_sd)} with ${learners.n} learners, or ${formatSd(words.sampling_sd)} with ${2 * words.k} total words.`;
    }
    byId("comparison-selection").textContent = `Your selected comparison · +${increase}% in one count`;
    byId("effect-takeaway").textContent = takeaway;
    elements.effectInterpretation.textContent = answer;
    byId("effect-variance-explanation").textContent = varianceExplanation;
    elements.effectNextStep.textContent = "Next: vary both slope SDs across plausible values. If the preferred expansion changes, document that sensitivity and seek compatible pilot estimates. Then consider recruitment cost, exposure time per word, and fatigue before choosing a design.";
    elements.reportingStarter.textContent = `Sensitivity inputs: N = ${inputs.n_person}, ${2 * inputs.k_per_condition} total words (${inputs.k_per_condition} per condition per learner), learner slope SD = ${inputs.person_slope_sd}, word slope SD = ${inputs.item_slope_sd}, memory variation = ${inputs.memory_moderation}; memory moderation ${inputs.memory_adjusted ? "assumed fully accounted for" : "left unmodeled"}. Requested increase: ${increase}% in one count, rounded up to whole learners or words per condition. ${takeaway} ${answer} ${varianceExplanation} These are projections from assumptions, not observed precision, power, or evidence that the design is validated.`;
    elements.effectComparison.hidden = false;
    renderEffectCurve(inputs, baseline);
    return plans;
  }

  function renderAssumptionComparison(inputs) {
    const increase = numberFrom(byId("effect-increase"));
    const sets = heldAssumptions.map(set => {
      let comparison;
      try {
        comparison = effectPlans({ ...inputs, ...set }, increase);
      } catch (error) {
        throw new RangeError(`Kept Set ${set.id}: ${error.message} Restore the previous study counts to compare or remove this set.`);
      }
      return { ...set, comparison, choice: expansionChoice(comparison, increase) };
    });
    const matching = sets.find(set => assumptionFields.every(field => set[field] === inputs[field]));
    const keepButton = byId("keep-effect-assumptions");
    keepButton.disabled = Boolean(matching) || sets.length === 3;
    keepButton.textContent = matching ? `Already kept as Set ${matching.id}`
      : sets.length === 3 ? "3 sets kept" : `Keep these assumptions (${sets.length}/3)`;
    byId("keep-assumptions-help").textContent = sets.length === 3
      ? "Three sets are kept below. Remove a set to make room for another."
      : matching ? "These assumptions are kept below. Change an assumption, then keep another set."
        : "Keep up to three sets to compare how the conclusion changes.";
    byId("assumption-set-count").textContent = `${sets.length} of 3 kept`;
    byId("assumption-common-counts").textContent = `Shared starting point: ${inputs.n_person} learners · ${2 * inputs.k_per_condition} total words. Requested increase: +${increase}%. Alternatives: ${Math.ceil(inputs.n_person * (100 + increase) / 100)} learners or ${2 * Math.ceil(inputs.k_per_condition * (100 + increase) / 100)} total words, with the other count unchanged.`;
    const choices = new Set(sets.map(set => set.choice));
    let summary;
    if (!sets.length) summary = "Keep the current assumptions, then try another set.";
    else if (sets.length === 1) summary = "One set kept. Add a different set to check whether the conclusion changes.";
    else if (increase === 0) summary = "No increase is selected. Choose an increase to compare larger studies across the kept sets.";
    else if (choices.has("learners") && choices.has("words")) summary = "The preferred expansion changes across the kept sets. The choice between more learners and more words depends on the assumptions you tried.";
    else if (choices.has("zero_variation")) summary = "At least one set assumes zero included variation, so its SD reductions are undefined. Inspect the other sets individually; zero variation does not imply perfect precision.";
    else if (choices.size === 1 && choices.has("tie")) summary = "Both expansions give equal reductions in every kept set. This applies only to the values and study sizes compared here.";
    else if (choices.size === 1) summary = `Adding ${choices.has("learners") ? "learners" : "words"} reduces variation more in every kept set. This agreement applies only to the values and study sizes compared here.`;
    else summary = `Some kept sets give equal reductions; others favor more ${choices.has("learners") ? "learners" : "words"}. The conclusion is not identical across sets.`;
    byId("assumption-comparison-summary").textContent = summary;
    const choiceLabels = {
      learners: "Adding learners reduces SD more", words: "Adding words reduces SD more",
      tie: "Equal SD reductions", no_increase: "No increase selected",
      zero_variation: "Zero included variation; reductions undefined"
    };
    byId("assumption-set-cards").replaceChildren(...sets.map(set => {
      const card = document.createElement("section");
      card.className = "assumption-set-card";
      card.setAttribute("aria-labelledby", `assumption-set-title-${set.id}`);
      const [baseline, learners, words] = set.comparison;
      const reduction = plan => plan.sd_reduction === null ? "Reduction undefined" : `${(100 * plan.sd_reduction).toFixed(1)}% lower SD`;
      // Only validated numeric inputs, generated integer IDs and fixed labels enter this markup.
      card.innerHTML = `<header><h6 id="assumption-set-title-${set.id}">Set ${set.id}</h6><button type="button" class="button button-quiet" data-remove-set="${set.id}" aria-label="Remove Set ${set.id}">Remove</button></header>
        <dl class="set-inputs"><div><dt>Learner slope SD</dt><dd>${set.person_slope_sd}</dd></div><div><dt>Word slope SD</dt><dd>${set.item_slope_sd}</dd></div><div><dt>Memory variation</dt><dd>${set.memory_moderation}</dd></div></dl>
        <p class="set-memory">Memory: ${set.memory_adjusted ? "fully accounted for" : "unmodeled"}</p>
        <p class="set-baseline">Starting SD: <strong>${formatSd(baseline.sampling_sd)}</strong></p>
        <div class="set-plan learner-readout"><span>More learners</span><strong>${reduction(learners)}</strong><span>SD ${formatSd(learners.sampling_sd)}</span></div>
        <div class="set-plan word-readout"><span>More words</span><strong>${reduction(words)}</strong><span>SD ${formatSd(words.sampling_sd)}</span></div>
        <p class="set-choice">${choiceLabels[set.choice]}</p>
        <button type="button" class="button button-secondary" data-use-set="${set.id}" aria-label="Use Set ${set.id} in chart">Use in chart</button>`;
      return card;
    }));
    byId("assumption-export-note").textContent = sets.length
      ? `Includes ${sets.length} kept assumption set${sets.length === 1 ? "" : "s"} and an additional vocabulary-assumption-comparison.csv with all set inputs and results. The PDF shows the current chart assumptions.`
      : "No additional assumption sets are kept. You can keep up to three in the Compare step.";
    if (sets.length) {
      const descriptions = sets.map(set => `Set ${set.id}: learner slope SD ${set.person_slope_sd}, word slope SD ${set.item_slope_sd}, memory variation ${set.memory_moderation} (${set.memory_adjusted ? "fully accounted for" : "unmodeled"}); ${choiceLabels[set.choice]}.`);
      elements.reportingStarter.textContent += ` Kept sets use the same counts and selected increase. ${descriptions.join(" ")} ${summary} Agreement is not evidence of robustness outside the compared sets.`;
    }
    return { n_person: inputs.n_person, k_per_condition: inputs.k_per_condition, increase_percent: increase, sets, summary };
  }

  function assumptionRCode() {
    if (!heldAssumptions.length) return [];
    const values = field => heldAssumptions.map(set => typeof set[field] === "boolean"
      ? set[field] ? "TRUE" : "FALSE" : set[field]).join(", ");
    return [
      "# 4. Kept assumption sets: all use the same counts and selected increase.",
      "# Agreement only concerns these sets; it does not establish robustness or power.",
      "assumption_sets <- data.frame(",
      `  set_id = c(${values("id")}),`,
      `  person_slope_sd = c(${values("person_slope_sd")}),`,
      `  item_slope_sd = c(${values("item_slope_sd")}),`,
      `  memory_moderation = c(${values("memory_moderation")}),`,
      `  memory_adjusted = c(${values("memory_adjusted")}))`,
      "stopifnot(all(is.finite(as.matrix(assumption_sets))),",
      "          all(assumption_sets$person_slope_sd >= 0),",
      "          all(assumption_sets$item_slope_sd >= 0),",
      "          all(assumption_sets$memory_moderation >= 0))",
      "assumption_sets$n_person <- n_person",
      "assumption_sets$k_per_condition <- k_per_condition",
      "assumption_sets$increase_percent <- increase_percent",
      "assumption_sets$n_more_learners <- expand_count(n_person, increase_percent)",
      "assumption_sets$total_more_words <- 2 * expand_count(k_per_condition, increase_percent)",
      "assumption_sets$baseline_sd <- with(assumption_sets,",
      "  project_sd(n_person, k_per_condition, person_slope_sd, item_slope_sd, memory_moderation, memory_adjusted))",
      "assumption_sets$sd_more_learners <- with(assumption_sets,",
      "  project_sd(n_more_learners, k_per_condition, person_slope_sd, item_slope_sd, memory_moderation, memory_adjusted))",
      "assumption_sets$sd_more_words <- with(assumption_sets,",
      "  project_sd(n_person, total_more_words / 2, person_slope_sd, item_slope_sd, memory_moderation, memory_adjusted))",
      "stopifnot(all(is.finite(as.matrix(assumption_sets))))",
      "assumption_sets$reduction_more_learners <- with(assumption_sets,",
      "  ifelse(baseline_sd > 0, 1 - sd_more_learners / baseline_sd, NA_real_))",
      "assumption_sets$reduction_more_words <- with(assumption_sets,",
      "  ifelse(baseline_sd > 0, 1 - sd_more_words / baseline_sd, NA_real_))",
      "assumption_sets$choice <- with(assumption_sets,",
      '  ifelse(baseline_sd == 0, "zero_variation",',
      '    ifelse(increase_percent == 0, "no_increase",',
      '      ifelse(abs(sd_more_learners - sd_more_words) <= baseline_sd * 1e-10, "tie",',
      '        ifelse(sd_more_learners < sd_more_words, "learners", "words")))))',
      'print(assumption_sets, row.names = FALSE, digits = 8)',
      'write.csv(assumption_sets, "vocabulary-assumption-comparison.csv", row.names = FALSE)',
      ""
    ];
  }

  function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => {
      if (typeof left === "number" && typeof right === "number") return left - right;
      return String(left).localeCompare(String(right));
    });
  }

  function replaceSelectValues(element, values, labelFor = value => String(value)) {
    const previous = element.value;
    const stringValues = values.map(value => String(value));
    element.replaceChildren(...values.map(value =>
      makeOption(String(value), labelFor(value), previous)
    ));
    if (stringValues.includes(previous)) element.value = previous;
  }

  function populateReferenceGridControls() {
    replaceSelectValues(
      elements.gridFamily,
      referenceGridRegistry.families.map(family => family.id),
      id => gridFamilyById.get(id).label
    );
    const family = gridFamilyById.get(elements.gridFamily.value) || referenceGridRegistry.families[0];
    const scenarioLabels = new Map(family.rows.map(row => [row.scenario, row.scenario_label]));
    replaceSelectValues(
      elements.gridScenario,
      uniqueSorted(family.rows.map(row => row.scenario)),
      scenario => scenarioLabels.get(scenario) || scenario
    );
    replaceSelectValues(elements.gridN, uniqueSorted(family.rows.map(row => row.n_person)));

    const isSim19 = family.id === "sim19_ecological_small";
    elements.gridScoringField.hidden = !isSim19;
    elements.gridKField.hidden = isSim19;
    elements.gridModelField.hidden = isSim19;
    if (isSim19) {
      replaceSelectValues(
        elements.gridScoring,
        uniqueSorted(family.rows.map(row => row.scoring_label))
      );
    } else {
      replaceSelectValues(
        elements.gridK,
        uniqueSorted(family.rows.map(row => row.k_per_condition))
      );
      replaceSelectValues(
        elements.gridModel,
        uniqueSorted(family.rows.map(row => row.model)),
        model => model === "base_condition"
          ? "Condition main effect"
          : "Condition × memory model"
      );
    }
    return family;
  }

  const formatPercent = value => value == null
    ? "Not in snapshot"
    : `${(100 * value).toFixed(1)}%`;
  const formatMetric = (value, digits = 3) => value == null
    ? "Not in snapshot"
    : Number(value).toFixed(digits);

  function metricCard(label, value) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    wrapper.append(term, description);
    return wrapper;
  }

  function renderReferenceGrid() {
    const family = populateReferenceGridControls();
    const selectedN = Number(elements.gridN.value);
    const coordinates = family.id === "sim19_ecological_small"
      ? {
          scenario: elements.gridScenario.value,
          n_person: selectedN,
          scoring_label: elements.gridScoring.value
        }
      : {
          scenario: elements.gridScenario.value,
          n_person: selectedN,
          k_per_condition: Number(elements.gridK.value),
          model: elements.gridModel.value
        };
    const rows = family.rows.filter(row => Object.entries(coordinates)
      .every(([key, value]) => row[key] === value));
    if (rows.length !== 1) {
      elements.gridRowTitle.textContent = "No exact row found";
      elements.referenceMetrics.replaceChildren();
      replaceList(elements.referenceLimitations, family.limitations);
      elements.gridDesignNote.textContent = "The browser will not interpolate a missing grid coordinate.";
      return { status: "exact_row_missing", family_id: family.id, coordinates };
    }

    const row = rows[0];
    elements.gridRowTitle.textContent = `${row.scenario_label} · exact ${row.n_rep}-replication row`;
    const metrics = family.id === "sim19_ecological_small"
      ? [
          ["Detection frequency", formatPercent(row.sig_rate)],
          ["Estimable", formatPercent(row.estimable_rate)],
          ["Singular fit", formatPercent(row.singular_rate)],
          ["Median beta", formatMetric(row.beta_median)],
          ["Median SE", formatMetric(row.se_median)],
          ["Replications", String(row.n_rep)]
        ]
      : [
          ["Detection frequency", formatPercent(row.sig_rate)],
          ["Estimable", formatPercent(row.estimable_rate)],
          ["Median condition beta", formatMetric(row.condition_beta_median)],
          ["Memory-interaction detection", formatPercent(row.memory_interaction_sig_rate)],
          ["Median marginal R²", formatMetric(row.r2_marginal_median)],
          ["Replications", String(row.n_rep)]
        ];
    elements.referenceMetrics.replaceChildren(...metrics.map(([label, value]) =>
      metricCard(label, value)
    ));
    replaceList(elements.referenceLimitations, family.limitations);
    const auditGate = conditionAuditGate();
    elements.gridDesignNote.textContent = auditGate.status === "blocked"
      ? `Current design: ${auditGate.title}. The published row remains visible only as a reference and cannot repair this block.`
      : "Current design passes the structural gate, but this row is still not transferred: matching visible coordinates is insufficient to establish DGP, assignment, scoring, and fitted-model equivalence.";
    return {
      status: "exact_published_reference",
      reference_grid_schema_version: referenceGridRegistry.schema_version,
      family_id: family.id,
      coordinates,
      row,
      applied_to_current_design: false
    };
  }

  function renderClaimRoute() {
    const branch = branchById.get(currentBranchId) || targetRegistry.branches[0];
    elements.routeBranch.textContent = `Branch ${branch.number}`;
    elements.routeQuestion.textContent = branch.question;
    elements.routeTarget.textContent = branch.inferential_target;
    replaceList(elements.alignedEvidence, branch.aligned_evidence);
    replaceList(elements.minimumReporting, branch.minimum_reporting);
    replaceList(elements.notLicense, branch.does_not_license);
    elements.reportingStarter.textContent = branch.reporting_starter;

    elements.alphaTool.hidden = branch.tool !== "alpha_expectation";
    elements.effectTool.hidden = branch.tool !== "effect_projection";
    elements.referenceGridTool.hidden = branch.tool !== "design_audit";
    elements.qualitativeTool.hidden = branch.tool !== "reporting_checklist";

    let gate;
    let calculation = null;
    if (branch.tool === "alpha_expectation") {
      gate = {
        status: "available",
        title: "Available without the design audit",
        message: "The closed-form identity can be evaluated locally after the exact score unit is defined; it predicts neither observed alpha nor construct validity."
      };
      calculation = renderAlphaProjection();
    } else if (branch.tool === "effect_projection") {
      gate = effectProjectionGate();
      calculation = renderEffectProjection(gate);
    } else if (branch.tool === "design_audit") {
      gate = conditionAuditGate();
      calculation = renderReferenceGrid();
    } else {
      gate = {
        status: "available",
        title: "Reporting checklist available",
        message: "This branch requires design and scoring evidence rather than a single numerical score. The design audit remains useful when a condition-effect claim is also made."
      };
      elements.qualitativeToolMessage.textContent = "Document response criteria, denominator and exclusions, task-format diagnostics, and any repeated-testing controls. Route any simultaneous score or condition-effect claim through its own branch.";
    }

    elements.routeGate.dataset.gate = gate.status;
    elements.routeGateTitle.textContent = gate.title;
    elements.routeGateMessage.textContent = gate.message;
    currentRoute = {
      claim_router_schema_version: targetRegistry.schema_version,
      decision_rules_schema_version: decisionRules.schema_version,
      execution_pathway: "browser_static",
      branch_id: branch.id,
      branch_number: branch.number,
      inferential_target: branch.inferential_target,
      gate,
      calculation
    };
    setPlannerStep(plannerStep);
    syncPayload();
  }

  function makeOption(value, label, selectedValue) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    return option;
  }

  function makeSelect(options, value, label) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (const [optionValue, optionLabel] of options) {
      select.append(makeOption(optionValue, optionLabel, value));
    }
    return select;
  }

  function makeInput(type, value, label) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    input.setAttribute("aria-label", label);
    if (type === "number") {
      input.min = "0";
      input.step = "1";
      input.inputMode = "numeric";
    }
    return input;
  }

  function makeCell(control) {
    const cell = document.createElement("td");
    cell.append(control);
    return cell;
  }

  function renderFacetRows(facets) {
    elements.facetRows.replaceChildren();
    facets.forEach((facet, index) => {
      const row = document.createElement("tr");
      row.dataset.index = String(index);

      const idInput = makeInput("text", facet.id, `Facet ${index + 1} ID`);
      idInput.dataset.field = "id";
      const parentInput = makeInput("text", facet.parent ?? "", `Facet ${index + 1} parent`);
      parentInput.dataset.field = "parent";
      const levelsInput = makeInput("number", facet.n_levels, `Facet ${index + 1} levels`);
      levelsInput.min = "2";
      levelsInput.dataset.field = "n_levels";
      const variesSelect = makeSelect(
        [["true", "Yes"], ["false", "No"]],
        String(facet.condition_varies_within),
        `Condition varies within facet ${index + 1}`
      );
      variesSelect.dataset.field = "condition_varies_within";
      const targetSelect = makeSelect(
        [["true", "Yes"], ["false", "No"]],
        String(facet.generalization_target),
        `Facet ${index + 1} is a generalization target`
      );
      targetSelect.dataset.field = "generalization_target";
      const roleSelect = makeSelect(modelRoleOptions, facet.model_role, `Facet ${index + 1} model role`);
      roleSelect.dataset.field = "model_role";
      const dependenceSelect = makeSelect(dependenceOptions, facet.dependence, `Facet ${index + 1} dependence`);
      dependenceSelect.dataset.field = "dependence";
      const slopeSelect = makeSelect(slopeOptions, facet.slope, `Facet ${index + 1} slope`);
      slopeSelect.dataset.field = "slope";
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-facet";
      removeButton.dataset.removeIndex = String(index);
      removeButton.setAttribute("aria-label", `Remove facet ${facet.id || index + 1}`);
      removeButton.textContent = "×";

      row.append(
        makeCell(idInput),
        makeCell(parentInput),
        makeCell(levelsInput),
        makeCell(variesSelect),
        makeCell(targetSelect),
        makeCell(roleSelect),
        makeCell(dependenceSelect),
        makeCell(slopeSelect),
        makeCell(removeButton)
      );
      elements.facetRows.append(row);
    });
  }

  function splitIds(value) {
    return value.split(",").map(item => item.trim()).filter(Boolean);
  }

  function splitIntegers(value) {
    return value.split(",").map(item => item.trim()).filter(Boolean).map(Number);
  }

  function collectFacets() {
    return [...elements.facetRows.querySelectorAll("tr")].map(row => {
      const value = field => row.querySelector(`[data-field="${field}"]`).value;
      return {
        id: value("id").trim(),
        parent: value("parent").trim() || null,
        n_levels: Number(value("n_levels")),
        condition_varies_within: value("condition_varies_within") === "true",
        generalization_target: value("generalization_target") === "true",
        model_role: value("model_role"),
        dependence: value("dependence"),
        slope: value("slope")
      };
    });
  }

  function collectDesign() {
    return {
      schema_version: core.SCHEMA_VERSION,
      units: {
        assignment: splitIds(elements.assignmentFacets.value),
        sampling: splitIds(elements.samplingFacets.value),
        observation: elements.observation.value.trim(),
        analysis: elements.analysis.value.trim()
      },
      assignment: {
        mode: elements.mode.value,
        condition_levels: Number(elements.conditionLevels.value),
        independent_units_per_condition: splitIntegers(elements.replication.value)
      },
      facets: collectFacets()
    };
  }

  function loadFixture(id) {
    const fixture = fixtureById.get(id) || fixtures[0];
    const design = clone(fixture.design);
    elements.template.value = fixture.id;
    elements.templateDescription.textContent = templateDescriptions[fixture.id] || "Adversarial design example.";
    elements.mode.value = design.assignment.mode;
    elements.conditionLevels.value = design.assignment.condition_levels;
    elements.assignmentFacets.value = design.units.assignment.join(", ");
    elements.samplingFacets.value = design.units.sampling.join(", ");
    elements.replication.value = design.assignment.independent_units_per_condition.join(", ");
    elements.observation.value = design.units.observation;
    elements.analysis.value = design.units.analysis;
    renderFacetRows(design.facets);
    evaluateDesign();
  }

  function issueCard(issue) {
    const card = document.createElement("article");
    card.className = "issue-card";
    card.dataset.severity = issue.severity;
    const header = document.createElement("header");
    const code = document.createElement("span");
    code.className = "issue-code";
    code.textContent = issue.facet ? `${issue.code} · ${issue.facet}` : issue.code;
    const severity = document.createElement("span");
    severity.className = "issue-severity";
    severity.textContent = issue.severity;
    header.append(code, severity);
    const message = document.createElement("p");
    message.textContent = issue.message;
    const action = document.createElement("p");
    action.className = "issue-action";
    action.textContent = `Next: ${issue.action}`;
    card.append(header, message, action);
    return card;
  }

  function formatFacets(values, emptyLabel) {
    return values.length ? values.join(" · ") : emptyLabel;
  }

  function markInvalidFields(result) {
    for (const field of elements.form.querySelectorAll("[aria-invalid]")) {
      field.removeAttribute("aria-invalid");
    }
    const codes = new Set(result.issues.filter(issue => issue.severity === "fatal").map(issue => issue.code));
    if (codes.has("condition_levels")) elements.conditionLevels.setAttribute("aria-invalid", "true");
    if (codes.has("assignment_replication_missing") || codes.has("assignment_not_replicated") ||
        codes.has("assignment_replication_length")) {
      elements.replication.setAttribute("aria-invalid", "true");
    }
    if (codes.has("assignment_unit_missing") || codes.has("unknown_assignment_unit") ||
        codes.has("assignment_variation_mismatch") || codes.has("crossed_assignment_facets")) {
      elements.assignmentFacets.setAttribute("aria-invalid", "true");
    }
  }

  function renderResult(design, result) {
    elements.stateCard.dataset.state = result.state;
    elements.stateTitle.textContent = result.state;
    elements.stateDescription.textContent = stateDescriptions[result.state];
    elements.issueCount.textContent = String(result.issues.length);
    elements.issueList.replaceChildren();
    if (result.issues.length) {
      result.issues.forEach(issue => elements.issueList.append(issueCard(issue)));
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-issues";
      empty.textContent = validatedIds.length
        ? "No structural reason codes were raised. Registry matching still requires the exact reviewed envelope."
        : "No structural reason codes were raised. The validation registry is empty, so numerical certification remains unavailable.";
      elements.issueList.append(empty);
    }
    elements.formula.textContent = result.can_compute && result.formula_suggestion
      ? result.formula_suggestion
      : "Suppressed: resolve identification or model-scope issues first.";
    elements.generalizes.textContent = formatFacets(
      result.claim_boundary.generalizes_over,
      "None established"
    );
    elements.notGeneralizes.textContent = formatFacets(
      result.claim_boundary.does_not_generalize_over,
      "None flagged"
    );
    currentAudit = {
      audit_contract_version: core.SCHEMA_VERSION,
      validation_registry_version: registry.registry_version,
      evaluated_locally: true,
      design,
      result
    };
    markInvalidFields(result);
    renderClaimRoute();
  }

  function evaluateDesign() {
    const design = collectDesign();
    const result = core.auditDesignGraph(design, validatedIds);
    renderResult(design, result);
  }

  function scheduleEvaluation() {
    window.clearTimeout(evaluationTimer);
    evaluationTimer = window.setTimeout(evaluateDesign, 120);
  }

  function nextFacetId(existingFacets) {
    let index = existingFacets.length + 1;
    let candidate = `facet_${index}`;
    const ids = new Set(existingFacets.map(facet => facet.id));
    while (ids.has(candidate)) {
      index += 1;
      candidate = `facet_${index}`;
    }
    return candidate;
  }

  async function copyPayload() {
    if (!currentAudit) return;
    const text = JSON.stringify(currentAudit, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const original = elements.copy.textContent;
      elements.copy.textContent = "Copied";
      window.setTimeout(() => { elements.copy.textContent = original; }, 1200);
    } catch {
      elements.payload.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function downloadPayload() {
    if (!currentAudit) return;
    downloadText(`${JSON.stringify(currentAudit, null, 2)}\n`, "design-structure-audit.json", "application/json");
  }

  function downloadText(text, filename, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  for (const fixture of fixtures) {
    elements.template.append(makeOption(
      fixture.id,
      templateLabels[fixture.id] || fixture.id,
      fixtures[0].id
    ));
  }
  for (const branch of targetRegistry.branches) {
    elements.claimOptions.append(makeClaimOption(branch, branch.id === currentBranchId));
  }
  elements.logicVersion.textContent = core.SCHEMA_VERSION;
  elements.decisionVersion.textContent = decisionRules.schema_version;
  elements.registryVersion.textContent = registry.registry_version;
  elements.registryCount.textContent = `${validatedIds.length} validated envelope${validatedIds.length === 1 ? "" : "s"}`;

  elements.template.addEventListener("change", () => loadFixture(elements.template.value));
  byId("start-effect-planning").addEventListener("click", () => {
    byId("resume-effect-planning").hidden = false;
    byId("restart-example-help").hidden = false;
    byId("start-effect-planning").textContent = "Restart with example inputs";
    byId("start-effect-planning").className = "button button-secondary";
    byId("start-effect-planning").setAttribute("aria-describedby", "restart-example-help");
    showMode("guided");
    plannerStep = 0;
    byId("effect-increase").value = 100;
    currentBranchId = "effect_generalizability";
    for (const radio of elements.claimOptions.querySelectorAll("input")) radio.checked = radio.value === currentBranchId;
    for (const [field, value] of [[elements.effectN, 120], [elements.effectK, 15],
      [elements.effectPersonSd, .35], [elements.effectItemSd, .18], [elements.effectMemory, .2]]) field.value = value;
    elements.effectMemoryAdjusted.checked = false;
    loadFixture("two_facet_counterbalanced");
    byId("design-details").open = false;
    setPlannerStep(0, true);
  });
  byId("resume-effect-planning").addEventListener("click", () => {
    showMode("guided");
    currentBranchId = "effect_generalizability";
    for (const radio of elements.claimOptions.querySelectorAll("input")) radio.checked = radio.value === currentBranchId;
    renderClaimRoute();
    setPlannerStep(plannerStep, true);
  });
  byId("open-all-tools").addEventListener("click", () => {
    showMode("advanced");
    byId("claim-router-title").setAttribute("tabindex", "-1");
    byId("claim-router-title").focus();
  });
  byId("show-overview").addEventListener("click", () => {
    showMode("overview");
    byId("planning-entry-title").focus();
  });
  for (const button of elements.effectTool.querySelectorAll("[data-plan-step]")) {
    button.addEventListener("click", () => setPlannerStep(Number(button.dataset.planStep), true));
  }
  byId("effect-curve").addEventListener("pointermove", event => inspectCurve(curveIncreaseAt(event)));
  byId("effect-curve").addEventListener("pointerleave", () => inspectCurve(numberFrom(byId("effect-increase"))));
  byId("effect-curve").addEventListener("click", event => {
    if (!curvePoints.length) return;
    byId("effect-increase").value = curveIncreaseAt(event);
    renderClaimRoute();
  });
  window.addEventListener("resize", () => {
    if (!elements.effectTool.hidden && plannerStep === 1 && currentRoute?.calculation?.status === "computed_sensitivity") {
      renderEffectCurve(currentRoute.calculation.inputs, currentRoute.calculation.result);
    }
  });
  byId("download-effect-r").addEventListener("click", () => {
    if (currentBranchId !== "effect_generalizability" || currentRoute?.calculation?.status !== "computed_sensitivity") return;
    downloadText(byId("effect-r-code").textContent, "vocabulary-design-sensitivity.R", "text/plain;charset=utf-8");
    byId("r-download-status").textContent = "R script prepared. Open your browser's downloads to find it.";
  });
  byId("review-effect-design").addEventListener("click", () => {
    byId("design-details").open = true;
  });
  for (const id of ["review-effect-assumptions", "edit-comparison-assumptions"]) {
    byId(id).addEventListener("click", () => {
      setPlannerStep(0);
      byId("effect-assumptions").open = true;
      elements.effectPersonSd.focus();
    });
  }
  byId("keep-effect-assumptions").addEventListener("click", () => {
    if (currentBranchId !== "effect_generalizability" || currentRoute?.calculation?.status !== "computed_sensitivity") return;
    const inputs = currentRoute.calculation.inputs;
    if (heldAssumptions.length >= 3 || heldAssumptions.some(set => assumptionFields.every(field => set[field] === inputs[field]))) return;
    heldAssumptions.push({ id: nextAssumptionSet++, ...Object.fromEntries(assumptionFields.map(field => [field, inputs[field]])) });
    renderClaimRoute();
    byId("assumption-comparison").open = true;
    byId("assumption-comparison").querySelector("summary").focus({ preventScroll: true });
    byId("assumption-comparison").scrollIntoView?.({ block: "start" });
  });
  byId("assumption-set-cards").addEventListener("click", event => {
    if (currentRoute?.calculation?.status !== "computed_sensitivity") return;
    const remove = event.target.closest("[data-remove-set]");
    const use = event.target.closest("[data-use-set]");
    if (remove) {
      const index = heldAssumptions.findIndex(set => set.id === Number(remove.dataset.removeSet));
      heldAssumptions = heldAssumptions.filter(set => set.id !== Number(remove.dataset.removeSet));
      renderClaimRoute();
      const neighbor = heldAssumptions[index] || heldAssumptions[index - 1];
      const nextControl = neighbor
        ? byId("assumption-set-cards").querySelector(`[data-remove-set="${neighbor.id}"]`)
        : byId("edit-comparison-assumptions");
      nextControl.focus();
    } else if (use) {
      const set = heldAssumptions.find(set => set.id === Number(use.dataset.useSet));
      elements.effectPersonSd.value = set.person_slope_sd;
      elements.effectItemSd.value = set.item_slope_sd;
      elements.effectMemory.value = set.memory_moderation;
      elements.effectMemoryAdjusted.checked = set.memory_adjusted;
      renderClaimRoute();
      setPlannerStep(1);
      byId("effect-increase").focus();
    }
  });
  elements.reset.addEventListener("click", () => loadFixture(elements.template.value));
  elements.evaluate.addEventListener("click", () => {
    window.clearTimeout(evaluationTimer);
    evaluateDesign();
    elements.stateTitle.focus({ preventScroll: true });
    elements.stateTitle.scrollIntoView?.({ block: "start" });
  });
  elements.addFacet.addEventListener("click", () => {
    const design = collectDesign();
    design.facets.push({
      id: nextFacetId(design.facets),
      parent: null,
      n_levels: 10,
      condition_varies_within: true,
      generalization_target: true,
      model_role: "random",
      dependence: "iid",
      slope: "diag"
    });
    renderFacetRows(design.facets);
    evaluateDesign();
  });
  elements.facetRows.addEventListener("click", event => {
    const removeButton = event.target.closest("[data-remove-index]");
    if (!removeButton) return;
    const design = collectDesign();
    design.facets.splice(Number(removeButton.dataset.removeIndex), 1);
    renderFacetRows(design.facets);
    evaluateDesign();
  });
  elements.form.addEventListener("input", scheduleEvaluation);
  elements.form.addEventListener("change", scheduleEvaluation);
  elements.copy.addEventListener("click", copyPayload);
  elements.download.addEventListener("click", downloadPayload);
  elements.claimOptions.addEventListener("change", event => {
    if (event.target.matches('input[name="claim-target"]')) {
      currentBranchId = event.target.value;
      renderClaimRoute();
    }
  });
  for (const input of elements.alphaTool.querySelectorAll("input")) {
    input.addEventListener("input", renderClaimRoute);
    input.addEventListener("change", renderClaimRoute);
  }
  for (const input of elements.effectTool.querySelectorAll("input")) {
    input.addEventListener("input", renderClaimRoute);
    input.addEventListener("change", renderClaimRoute);
  }
  for (const select of elements.referenceGridTool.querySelectorAll("select")) {
    select.addEventListener("change", renderClaimRoute);
  }

  loadFixture(fixtures[0].id);
  showMode("overview");
})();
