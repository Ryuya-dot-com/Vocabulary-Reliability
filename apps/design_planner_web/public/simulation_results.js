/* Local summary.csv reader. This view never sends file contents over a network. */
(() => {
  "use strict";
  const MAX_BYTES = 65536;
  function csvRows(text) {
    const rows = []; let row = [], cell = "", quoted = false, closed = false;
    text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else cell += c;
      } else if (c === "," || c === "\n") {
        row.push(cell); cell = ""; closed = false;
        if (c === "\n") { rows.push(row); row = []; }
      } else if (c === '"' && !cell && !closed) quoted = true;
      else if (closed || c === '"') throw Error("Malformed CSV quoting.");
      else cell += c;
    }
    if (quoted) throw Error("Unclosed CSV quote.");
    if (cell || row.length || closed) { row.push(cell); rows.push(row); }
    return rows;
  }
  function parseSummary(text) {
    if (text.length > MAX_BYTES) throw Error("Choose a summary.csv smaller than 64 KB, not replications.csv.");
    const rows = csvRows(text);
    if (rows.length !== 2 || rows[0].length !== rows[1].length || new Set(rows[0]).size !== rows[0].length)
      throw Error("Expected one header and one summary row. Choose summary.csv from a completed simulation.");
    const data = Object.fromEntries(rows[0].map((key, i) => [key, rows[1][i]]));
    const number = (key, missing = false) => {
      if (!(key in data)) throw Error(`Missing column: ${key}. Use the planner's simulation summary.csv.`);
      const raw = data[key];
      if (missing && raw === "NA") return null;
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) throw Error(`Invalid number in ${key}.`);
      return Number(raw);
    };
    const result = { term: data.test_term, truth: number("true_coefficient"), alpha: "alpha" in data ? number("alpha") : null };
    if (!result.term || result.term.length > 200 || (result.alpha !== null && !(result.alpha > 0 && result.alpha < 1))) throw Error("Invalid coefficient or significance level.");
    const counts = ["requested_reps", "usable_reps", "failed_reps", "invalid_estimate_reps", "unusable_reps", "nonconverged_reps", "singular_fits", "usable_nonsingular_reps"];
    for (const key of counts) {
      result[key] = number(key);
      if (!Number.isInteger(result[key]) || result[key] < 0 || result[key] > 10000) throw Error(`Invalid count in ${key}.`);
    }
    const n = result.requested_reps, u = result.usable_reps, ns = result.usable_nonsingular_reps;
    if (n < 2 || u + result.unusable_reps !== n || result.failed_reps + result.nonconverged_reps + result.invalid_estimate_reps !== result.unusable_reps || ns > u || result.singular_fits < u - ns || result.singular_fits > n - ns)
      throw Error("Replication counts are inconsistent.");
    const rate = (key, denominator) => {
      const value = number(key, denominator === 0);
      if ((denominator === 0 && value !== null) || (denominator > 0 && (value < 0 || value > 1))) throw Error(`Invalid rate in ${key}.`);
      if (value !== null && Math.abs(value * denominator - Math.round(value * denominator)) > 1e-6) throw Error(`Rate and denominator disagree in ${key}.`);
      return value;
    };
    result.rejection_usable = rate("rejection_usable", u);
    result.rejection_nonsingular = rate("rejection_nonsingular", ns);
    result.coverage_95_usable = rate("coverage_95_usable", u);
    const intervals = [
      ["rejection_usable", "rejection_wilson_low", "rejection_wilson_high", "rejection_mcse", u],
      ["rejection_nonsingular", "rejection_nonsingular_low", "rejection_nonsingular_high", "rejection_nonsingular_mcse", ns],
      ["coverage_95_usable", "coverage_wilson_low", "coverage_wilson_high", "coverage_mcse", u]
    ];
    for (const [key, low, high, mcse, denominator] of intervals) {
      for (const name of [low, high, mcse]) result[name] = number(name, denominator === 0);
      if (!denominator) {
        if ([low, high, mcse].some(name => result[name] !== null)) throw Error("An empty denominator must have NA uncertainty.");
      } else {
        const p = result[key], z = 1.959963984540054;
        const center = (p + z * z / (2 * denominator)) / (1 + z * z / denominator);
        const half = z * Math.sqrt(p * (1 - p) / denominator + z * z / (4 * denominator ** 2)) / (1 + z * z / denominator);
        const expected = [Math.max(0, center - half), Math.min(1, center + half), Math.sqrt(p * (1 - p) / denominator)];
        if ([low, high, mcse].some((name, i) => Math.abs(result[name] - expected[i]) > 1e-6)) throw Error("Uncertainty does not match the rate and denominator.");
      }
    }
    const detected = u ? Math.round(result.rejection_usable * u) : 0;
    if (Math.round(result.rejection_nonsingular * ns) > detected || detected - Math.round(result.rejection_nonsingular * ns) > u - ns) throw Error("Singular and nonsingular rejection counts disagree.");
    result.rejection_missing_lower = number("rejection_missing_lower");
    result.rejection_missing_upper = number("rejection_missing_upper");
    if (Math.abs(result.rejection_missing_lower - detected / n) > 1e-6 || Math.abs(result.rejection_missing_upper - (detected + n - u) / n) > 1e-6) throw Error("Missing-result bounds disagree with replication counts.");
    return result;
  }
  window.SimulationResults = { parseSummary };

  const byId = id => document.getElementById(id);
  const fileInput = byId("simulation-summary-file");
  if (!fileInput) return;
  byId("open-simulation-results").addEventListener("click", () => {
    byId("simulation-results").open = true;
  });
  let report = null, readVersion = 0;
  const percent = value => value === null ? "Not estimable" : `${(100 * value).toFixed(1)}%`;
  const set = (id, text) => { byId(id).textContent = text; };
  function interval(label, value, low, high, denominator, mcse) {
    const card = document.createElement("section"); card.className = "simulation-rate";
    const title = document.createElement("h3"); title.textContent = label; card.append(title);
    const summary = document.createElement("p");
    summary.textContent = value === null ? "Not estimable: no usable replications." : `${percent(value)} · ${Math.round(value * denominator)} / ${denominator} replications`;
    card.append(summary);
    if (value !== null) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 320 44"); svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `${label}: ${percent(value)}, 95% Wilson interval ${percent(low)} to ${percent(high)}.`);
      // Only validated numbers enter these SVG attributes; labels use textContent.
      svg.innerHTML = `<line x1="10" x2="310" y1="16" y2="16" class="rate-axis"/><line x1="${10 + low * 300}" x2="${10 + high * 300}" y1="16" y2="16" class="rate-interval"/><circle cx="${10 + value * 300}" cy="16" r="5" class="rate-point"/><text x="10" y="40">0%</text><text x="310" y="40" text-anchor="end">100%</text>`;
      card.append(svg);
      const uncertainty = document.createElement("p"); uncertainty.className = "result-caption";
      uncertainty.textContent = `95% Wilson interval: ${percent(low)}–${percent(high)}. Monte Carlo SE: ${(100 * mcse).toFixed(2)} percentage points.`;
      card.append(uncertainty);
    }
    return card;
  }
  function render() {
    if (!report) return;
    const r = report, ns = byId("simulation-exclude-singular").checked;
    set("simulation-report-context", `Imported coefficient: ${r.term} · true logit coefficient: ${r.truth} · ${r.alpha === null ? "significance level not recorded in this older export; check README.txt" : `two-sided alpha: ${r.alpha}`}. These results are independent of the planner inputs above.`);
    set("simulation-report-health", `${r.usable_reps} / ${r.requested_reps} usable; ${r.nonconverged_reps} nonconverged; ${r.failed_reps} failed; ${r.invalid_estimate_reps} invalid estimates. ${r.singular_fits} singular fits in total, including ${r.usable_reps - r.usable_nonsingular_reps} among usable fits.`);
    set("simulation-report-warning", r.unusable_reps ? `Conditional results omit ${r.unusable_reps} unusable replications. Read the missing-result bounds before interpreting ${r.truth === 0 ? "Type I error" : "power"}.` : "All replications were usable. This does not establish Wald-test calibration or validate the design assumptions.");
    const rejection = ns ? [r.rejection_nonsingular, r.rejection_nonsingular_low, r.rejection_nonsingular_high, r.usable_nonsingular_reps, r.rejection_nonsingular_mcse] : [r.rejection_usable, r.rejection_wilson_low, r.rejection_wilson_high, r.usable_reps, r.rejection_mcse];
    byId("simulation-report-rates").replaceChildren(
      interval(`${r.truth === 0 ? "Type I error" : "Power"} · ${ns ? "usable nonsingular fits" : "all usable fits"}`, ...rejection),
      interval("95% coefficient-interval coverage · all usable fits", r.coverage_95_usable, r.coverage_wilson_low, r.coverage_wilson_high, r.usable_reps, r.coverage_mcse));
    set("simulation-report-bounds", `${percent(r.rejection_missing_lower)}–${percent(r.rejection_missing_upper)} of all ${r.requested_reps} requested replications. This ranges from none to all unusable replications rejecting the null. It includes usable singular fits and does not change with the switch above. It is a sensitivity range, not a confidence interval.`);
  }
  fileInput.addEventListener("change", async () => {
    const version = ++readVersion, file = fileInput.files[0];
    report = null; byId("simulation-report").hidden = true;
    byId("simulation-exclude-singular").checked = false;
    if (!file) { set("simulation-import-status", "No file selected."); return; }
    set("simulation-import-status", "Reading locally…");
    try {
      if (file.size > MAX_BYTES) throw Error("Choose a summary.csv smaller than 64 KB, not replications.csv.");
      const text = await file.text();
      if (version !== readVersion) return;
      report = parseSummary(text); render(); byId("simulation-report").hidden = false;
      set("simulation-import-status", `Loaded ${file.name} locally. No file contents were sent.`);
    } catch (error) {
      if (version === readVersion) set("simulation-import-status", `Could not read this summary: ${error.message}`);
    }
  });
  byId("simulation-exclude-singular").addEventListener("change", render);
  byId("clear-simulation-results").addEventListener("click", () => {
    readVersion++; report = null; fileInput.value = "";
    byId("simulation-report").hidden = true;
    byId("simulation-report-rates").replaceChildren();
    for (const id of ["context", "health", "warning", "bounds"]) set(`simulation-report-${id}`, "");
    byId("simulation-exclude-singular").checked = false;
    set("simulation-import-status", "Imported results cleared.");
  });
})();
