/* Pure design-graph validation shared by a browser/Cloudflare frontend.
 * Keep state labels, reason codes, and formula construction in parity with
 * design_audit.R. No DOM, network, storage, or Node-only APIs are used here.
 */
(function attachDesignAudit(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DesignAudit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function designAuditFactory() {
  "use strict";

  const SCHEMA_VERSION = "1.0.0";
  const STATES = Object.freeze([
    "Not identifiable",
    "Outside supported model class",
    "Estimable but fragile",
    "Within validated envelope"
  ]);
  const ASSIGNMENT_MODES = new Set([
    "within_unit", "between_unit", "crossed_counterbalance"
  ]);
  const MODEL_ROLES = new Set(["random", "fixed", "omitted"]);
  const SUPPORTED_DEPENDENCE = new Set(["iid", "diag", "us", "cs", "ar1"]);
  const UNSUPPORTED_DEPENDENCE = new Set([
    "spatial", "multiple_membership", "custom_residual",
    "informative_cluster_size"
  ]);
  const SLOPES = new Set(["none", "diag", "us", "cs", "ar1"]);

  const scalarString = value =>
    typeof value === "string" && value.trim().length > 0;
  const scalarBoolean = value => typeof value === "boolean";
  const wholeNumber = (value, minimum = 0) =>
    Number.isInteger(value) && value >= minimum;
  const asArray = value => Array.isArray(value) ? value : [];
  const unique = values => [...new Set(values)];

  function auditDesignGraph(design, validatedIds = []) {
    if (!design || typeof design !== "object" || Array.isArray(design)) {
      throw new TypeError("design must be an object");
    }

    const issues = [];
    const addIssue = (code, severity, facet, message, action) => {
      issues.push({ code, severity, facet: facet || "", message, action });
    };

    if (design.schema_version !== SCHEMA_VERSION) {
      addIssue(
        "schema_version", "fatal", "",
        `Expected schema_version ${SCHEMA_VERSION}; received ${design.schema_version ?? "<missing>"}.`,
        "Migrate the payload before evaluating the design."
      );
    }

    const units = design.units && typeof design.units === "object" ? design.units : {};
    const assignment = design.assignment && typeof design.assignment === "object"
      ? design.assignment : {};
    const facets = Array.isArray(design.facets) ? design.facets : [];
    if (!design.units || typeof design.units !== "object") {
      addIssue(
        "units_missing", "fatal", "", "The units block is missing.",
        "Report assignment, sampling, observation, and analysis units separately."
      );
    }
    if (!design.assignment || typeof design.assignment !== "object") {
      addIssue(
        "assignment_missing", "fatal", "", "The assignment block is missing.",
        "Report assignment mode, condition levels, and independent assignment replication."
      );
    }
    if (facets.length === 0) {
      addIssue(
        "facets_missing", "fatal", "", "No facets were supplied.",
        "Add every sampled or conditioned facet explicitly; do not infer them from labels."
      );
    }

    for (const field of ["assignment", "sampling", "observation", "analysis"]) {
      const value = units[field];
      const present = field === "assignment" || field === "sampling"
        ? Array.isArray(value) && value.length > 0 && value.every(scalarString)
        : scalarString(value);
      if (!present) {
        addIssue(
          `${field}_unit_missing`, "fatal", "",
          `The ${field} unit is missing or empty.`,
          `Specify the ${field} unit independently of the other units.`
        );
      }
    }

    const mode = assignment.mode;
    if (!scalarString(mode) || !ASSIGNMENT_MODES.has(mode)) {
      addIssue(
        "assignment_mode", "fatal", "",
        "Assignment mode must be within_unit, between_unit, or crossed_counterbalance.",
        "Describe how condition was assigned rather than inferring it from the analysis model."
      );
    }
    const conditionLevels = assignment.condition_levels;
    if (!wholeNumber(conditionLevels, 2)) {
      addIssue(
        "condition_levels", "fatal", "",
        "condition_levels must be an integer of at least two.",
        "Report every observed condition level."
      );
    }
    const replication = asArray(assignment.independent_units_per_condition);
    const replicationOk = replication.length > 0 &&
      replication.every(value => wholeNumber(value, 1));
    if (!replicationOk) {
      addIssue(
        "assignment_replication_missing", "fatal", "",
        "Independent assignment units per condition are missing or invalid.",
        "Count independent randomized or assigned units, not rows or repeated observations."
      );
    } else if (replication.some(value => value < 2)) {
      addIssue(
        "assignment_not_replicated", "fatal", "",
        "At least one condition has fewer than two independent assignment units.",
        "Do not estimate a condition effect that is perfectly aliased with a single assignment unit."
      );
    }
    if (replicationOk && wholeNumber(conditionLevels, 2) &&
        replication.length !== 1 && replication.length !== conditionLevels) {
      addIssue(
        "assignment_replication_length", "fatal", "",
        "independent_units_per_condition must have length one or one value per condition.",
        "Supply a common count or condition-specific counts."
      );
    }

    const facetIds = [];
    const facetParents = [];
    const randomTerms = [];
    const generalizesOver = [];
    const doesNotGeneralizeOver = [];

    facets.forEach((facetValue, index) => {
      const facet = facetValue && typeof facetValue === "object" && !Array.isArray(facetValue)
        ? facetValue : null;
      if (!facet) {
        addIssue(
          "facet_type", "fatal", `facet_${index + 1}`,
          "Each facet must be a named object.",
          "Supply id, parent, n_levels, condition_varies_within, generalization_target, model_role, dependence, and slope."
        );
        facetIds.push(`facet_${index + 1}`);
        facetParents.push("");
        return;
      }

      let validFacet = true;
      const id = scalarString(facet.id) ? facet.id : `facet_${index + 1}`;
      if (!scalarString(facet.id)) {
        addIssue("facet_id", "fatal", id, "Facet id is missing or empty.",
          "Give every facet a stable unique id.");
        validFacet = false;
      }
      facetIds.push(id);
      const parent = facet.parent == null ? "" : facet.parent;
      if (!(parent === "" || scalarString(parent))) {
        addIssue(
          "facet_parent", "fatal", id,
          "Facet parent must be null or a single facet id.",
          "Encode each nesting edge explicitly."
        );
        facetParents.push("");
        validFacet = false;
      } else {
        facetParents.push(parent);
      }

      if (!wholeNumber(facet.n_levels, 2)) {
        addIssue(
          "facet_levels", "fatal", id,
          "A modeled facet must contain at least two observed levels.",
          "Report the observed number of levels or treat the single level as fixed context."
        );
        validFacet = false;
      }
      if (!scalarBoolean(facet.condition_varies_within)) {
        addIssue(
          "condition_variation", "fatal", id,
          "condition_varies_within must be explicitly true or false.",
          "Check the design matrix within this facet rather than guessing from its name."
        );
        validFacet = false;
      }
      if (!scalarBoolean(facet.generalization_target)) {
        addIssue(
          "generalization_target", "fatal", id,
          "generalization_target must be explicitly true or false.",
          "State whether the claim extends beyond the observed levels of this facet."
        );
        validFacet = false;
      }

      const role = facet.model_role;
      const dependence = facet.dependence;
      const slope = facet.slope;
      if (!scalarString(role) || !MODEL_ROLES.has(role)) {
        addIssue(
          "model_role", "fatal", id, "model_role must be random, fixed, or omitted.",
          "Choose the role from the estimand and sampling process, not from the facet label."
        );
        validFacet = false;
      }
      if (!scalarString(dependence) ||
          (!SUPPORTED_DEPENDENCE.has(dependence) && !UNSUPPORTED_DEPENDENCE.has(dependence))) {
        addIssue(
          "dependence", "fatal", id, "The dependence structure is missing or unknown.",
          "Use an explicit supported or unsupported structure code."
        );
        validFacet = false;
      } else if (UNSUPPORTED_DEPENDENCE.has(dependence)) {
        addIssue(
          `unsupported_${dependence}`, "unsupported", id,
          `Facet ${id} uses ${dependence} dependence, which this lme4-based app does not model.`,
          "Stop numerical guidance and route to a model that represents this dependence directly."
        );
      }
      if (!scalarString(slope) || !SLOPES.has(slope)) {
        addIssue(
          "slope_structure", "fatal", id,
          "slope must be none, diag, us, cs, or ar1.",
          "Specify the random-slope covariance structure explicitly."
        );
        validFacet = false;
      }

      if (facet.condition_varies_within === true && role === "random" &&
          slope === "none" && facet.generalization_target === true) {
        addIssue(
          "missing_random_slope", "warning", id,
          `Condition varies within generalization facet ${id}, but its condition slope is omitted.`,
          "Add a supported condition-slope structure or narrow the effect-generalization claim."
        );
        doesNotGeneralizeOver.push(id);
      }
      if (facet.condition_varies_within === false && slope !== "none") {
        addIssue(
          "slope_not_estimable", "fatal", id,
          `Condition does not vary within ${id}, so a condition slope for that facet is not estimable.`,
          "Remove the slope term; evaluate assignment-level replication and narrow heterogeneity claims."
        );
      }
      if (facet.generalization_target === true && role === "omitted") {
        addIssue(
          "generalization_facet_omitted", "warning", id,
          `Facet ${id} is a generalization target but is omitted from the model.`,
          "Model or resample this facet, or limit the claim to the observed levels."
        );
        doesNotGeneralizeOver.push(id);
      }
      if (role === "random" && wholeNumber(facet.n_levels, 2) && facet.n_levels < 5) {
        addIssue(
          "few_random_levels", "warning", id,
          `Facet ${id} has only ${facet.n_levels} observed levels; variance estimates may be boundary-sensitive.`,
          "Report boundary diagnostics and use design-specific simulation; this is a warning, not a universal cutoff."
        );
      }

      if (role === "random" && validFacet) {
        const term = slope === "none"
          ? `(1 | ${id})`
          : `${slope}(1 + condition_c | ${id})`;
        randomTerms.push(term);
        if (facet.generalization_target === true &&
            (facet.condition_varies_within !== true || slope !== "none")) {
          generalizesOver.push(id);
        }
      } else if (facet.generalization_target === true &&
                 !doesNotGeneralizeOver.includes(id)) {
        doesNotGeneralizeOver.push(id);
      }
    });

    unique(facetIds.filter((id, index) => facetIds.indexOf(id) !== index))
      .forEach(id => addIssue(
        "duplicate_facet", "fatal", id, `Facet id ${id} is duplicated.`,
        "Use one node per facet and stable globally unique level identifiers."
      ));

    const knownIds = unique(facetIds.filter(scalarString));
    facetParents.forEach((parent, index) => {
      const id = facetIds[index];
      if (parent && !knownIds.includes(parent)) {
        addIssue(
          "unknown_parent", "fatal", id, `Facet ${id} names unknown parent ${parent}.`,
          "Add the parent facet or remove the nesting edge."
        );
      }
      if (parent && parent === id) {
        addIssue(
          "self_parent", "fatal", id, `Facet ${id} cannot be its own parent.`,
          "Correct the nesting graph."
        );
      }
    });

    const parentMap = new Map(facetIds.map((id, index) => [id, facetParents[index]]));
    knownIds.forEach(id => {
      const seen = new Set();
      let current = id;
      while (current && parentMap.has(current)) {
        if (seen.has(current)) {
          addIssue(
            "parent_cycle", "fatal", id,
            `The nesting graph contains a cycle involving ${current}.`,
            "Replace the cycle with an acyclic hierarchy; represent crossing by leaving parent empty."
          );
          break;
        }
        seen.add(current);
        current = parentMap.get(current);
      }
    });

    for (const field of ["assignment", "sampling"]) {
      for (const ref of asArray(units[field])) {
        if (!knownIds.includes(ref)) {
          addIssue(
            `unknown_${field}_unit`, "fatal", ref,
            `${field[0].toUpperCase()}${field.slice(1)} unit ${ref} is not a declared facet.`,
            "Declare the facet and its relationships explicitly."
          );
        }
      }
    }

    const assignmentFacets = asArray(units.assignment);
    if (ASSIGNMENT_MODES.has(mode)) {
      const variation = assignmentFacets.map(ref => {
        const facet = facets.find(candidate => candidate && candidate.id === ref);
        return facet ? facet.condition_varies_within : undefined;
      });
      if ((mode === "within_unit" || mode === "crossed_counterbalance") &&
          variation.some(value => value !== true)) {
        addIssue(
          "assignment_variation_mismatch", "fatal", "",
          `Assignment mode ${mode} requires condition variation within every declared assignment facet.`,
          "Correct the assignment mode or the facet-level condition-variation declarations."
        );
      }
      if (mode === "crossed_counterbalance" && assignmentFacets.length < 2) {
        addIssue(
          "crossed_assignment_facets", "fatal", "",
          "crossed_counterbalance requires at least two crossed assignment facets.",
          "Name each crossed facet, such as participant and item."
        );
      }
    }

    const hasFatal = issues.some(issue => issue.severity === "fatal");
    const hasUnsupported = issues.some(issue => issue.severity === "unsupported");
    const hasWarning = issues.some(issue => issue.severity === "warning");
    const validationId = scalarString(design.validation_id) ? design.validation_id : "";
    const validated = new Set(validatedIds);
    const state = hasFatal ? "Not identifiable"
      : hasUnsupported ? "Outside supported model class"
      : !hasWarning && validationId && validated.has(validationId)
        ? "Within validated envelope"
        : "Estimable but fragile";
    const terms = unique(randomTerms);

    return {
      schema_version: SCHEMA_VERSION,
      state,
      can_compute: state === "Estimable but fragile" || state === "Within validated envelope",
      issues,
      random_effect_terms: terms,
      formula_suggestion: terms.length
        ? `outcome ~ condition_c + ${terms.join(" + ")}`
        : null,
      claim_boundary: {
        generalizes_over: unique(generalizesOver),
        does_not_generalize_over: unique(doesNotGeneralizeOver)
      }
    };
  }

  return Object.freeze({ SCHEMA_VERSION, STATES, auditDesignGraph });
});
