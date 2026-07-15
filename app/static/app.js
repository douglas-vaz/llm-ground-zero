"use strict";

const byId = (id) => document.getElementById(id);
const PALETTE = ["#58a6ff", "#d29922", "#bc8cff", "#3fb950", "#f85149", "#39c5cf", "#db61a2"];
const charts = new Map();
let loadInFlight = false;
let advisorData = null;
let lastEvidence = null;
let headroomSettings = null;

if (typeof Chart !== "undefined") {
  Chart.defaults.color = "#9da7b3";
  Chart.defaults.borderColor = "#30363d";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return "$" + number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTokens(value) {
  const v = number(value);
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
  return String(v);
}

function formatDuration(value) {
  const minutes = Math.max(0, Math.round(number(value) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function percent(value, total) {
  return total > 0 ? Math.max(0, Math.min(100, 100 * number(value) / total)) : 0;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ago(iso) {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + "m ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + "h ago";
  return Math.round(seconds / 86400) + "d ago";
}

function card(label, value, sub, isError = false) {
  const node = element("article", "card" + (isError ? " error-card" : ""));
  node.append(element("div", "label", label), element("div", "value", value));
  if (sub) node.append(element("div", "sub", sub));
  return node;
}

function setPanelState(id, message = "", isError = false) {
  const node = byId(id);
  node.textContent = message;
  node.classList.toggle("error", isError);
}

function destroyChart(id) {
  const chart = charts.get(id);
  if (chart) chart.destroy();
  charts.delete(id);
}

function makeChart(id, config, stateId, label) {
  destroyChart(id);
  const canvas = byId(id);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  if (typeof Chart === "undefined") {
    setPanelState(stateId, "Charts are unavailable. Reload the app or reinstall it.", true);
    return;
  }
  setPanelState(stateId);
  charts.set(id, new Chart(canvas, config));
}

function clearUsageCharts(message, isError) {
  for (const [chartId, stateId] of [
    ["dailyChart", "dailyState"], ["modelChart", "modelState"], ["agentChart", "agentState"],
  ]) {
    destroyChart(chartId);
    setPanelState(stateId, message, isError);
  }
}

function activeBlockSummary(blocks) {
  if (blocks.error) return card("Current 5h block", "—", blocks.error, true);
  const active = (blocks.blocks || []).find((entry) => entry.isActive && !entry.isGap);
  if (!active) return card("Current 5h block", "—", "no active block");
  const minutes = Math.max(0, Math.round((new Date(active.endTime).getTime() - Date.now()) / 60000));
  const reset = Number.isFinite(minutes) ? `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : "reset time unavailable";
  return card("Current 5h block", formatMoney(active.costUSD),
    `${reset} · ${formatMoney(active.burnRate?.costPerHour)}/h burn`);
}

function renderSummaries(usage, blocks) {
  const nodes = [];
  if (usage.error) {
    nodes.push(card("Usage unavailable", "—", usage.error, true));
  } else {
    const days = usage.daily || [];
    const todayKey = localDateKey();
    const monthKey = todayKey.slice(0, 7);
    const total = days.reduce((sum, day) => sum + number(day.totalCost), 0);
    const month = days.filter((day) => String(day.period).startsWith(monthKey))
      .reduce((sum, day) => sum + number(day.totalCost), 0);
    const today = days.filter((day) => day.period === todayKey)
      .reduce((sum, day) => sum + number(day.totalCost), 0);
    const tokens = days.reduce((sum, day) => sum + number(day.totalTokens), 0);
    const cacheRead = days.reduce((sum, day) => sum + number(day.cacheReadTokens), 0);
    const busiest = days.reduce((best, day) => number(day.totalCost) > number(best.totalCost) ? day : best,
      { totalCost: 0 });
    nodes.push(
      card("This month (API-equiv)", formatMoney(month), "pay-per-token equivalent"),
      card("Today", formatMoney(today)),
      activeBlockSummary(blocks),
      card("All time", formatMoney(total), `${days.length} active days`),
      card("Total tokens", formatTokens(tokens),
        `${formatTokens(cacheRead)} from cache (${Math.round(100 * cacheRead / Math.max(1, tokens))}%)`),
      card("Busiest day", busiest.period || "—", formatMoney(busiest.totalCost)),
    );
  }
  if (usage.error) nodes.push(activeBlockSummary(blocks));
  byId("cards").replaceChildren(...nodes);
}

function renderUsageCharts(usage) {
  if (usage.error) {
    clearUsageCharts(usage.error, true);
    return;
  }
  const days = usage.daily || [];
  if (!days.length) {
    clearUsageCharts("No usage data found.", false);
    return;
  }

  const last30 = days.slice(-30);
  const byAgent = (name) => last30.map((day) => (day.modelBreakdowns || [])
    .filter((model) => name === "claude"
      ? String(model.modelName).startsWith("claude")
      : !String(model.modelName).startsWith("claude"))
    .reduce((sum, model) => sum + number(model.cost), 0));
  makeChart("dailyChart", {
    type: "bar",
    data: {
      labels: last30.map((day) => String(day.period).slice(5)),
      datasets: [
        { label: "Claude models", data: byAgent("claude"), backgroundColor: PALETTE[1], stack: "s" },
        { label: "Other models", data: byAgent("other"), backgroundColor: PALETTE[0], stack: "s" },
      ],
    },
    options: {
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 10 } }, y: { stacked: true } },
      plugins: { legend: { position: "bottom" } },
    },
  }, "dailyState", `Daily API-equivalent spend for ${last30.length} active days`);

  const models = {};
  for (const day of days) {
    for (const model of day.modelBreakdowns || []) {
      const name = model.modelName || "unknown";
      models[name] = (models[name] || 0) + number(model.cost);
    }
  }
  const sortedModels = Object.entries(models).sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (sortedModels.length) {
    makeChart("modelChart", {
      type: "doughnut",
      data: {
        labels: sortedModels.map(([name]) => name.replace("claude-", "")),
        datasets: [{ data: sortedModels.map(([, cost]) => cost), backgroundColor: PALETTE, borderColor: "#161b22" }],
      },
      options: { plugins: { legend: { position: "bottom" } }, cutout: "62%" },
    }, "modelState", `Cost split across ${Object.keys(models).length} models`);
  } else {
    destroyChart("modelChart");
    setPanelState("modelState", "No model breakdown found.");
  }

  const agentTokens = {};
  for (const day of days) {
    for (const model of day.modelBreakdowns || []) {
      const modelName = String(model.modelName);
      const agent = modelName.startsWith("claude") ? "Claude Code"
        : modelName.startsWith("gpt") ? "Codex" : "Other";
      agentTokens[agent] = (agentTokens[agent] || 0) + number(model.inputTokens) + number(model.outputTokens)
        + number(model.cacheCreationTokens) + number(model.cacheReadTokens);
    }
  }
  makeChart("agentChart", {
    type: "bar",
    data: {
      labels: Object.keys(agentTokens),
      datasets: [{ data: Object.values(agentTokens), backgroundColor: [PALETTE[1], PALETTE[0], PALETTE[2]] }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: formatTokens } } },
    },
  }, "agentState", "Estimated token split inferred from model names");
}

function renderTools(tools) {
  if (tools.error) {
    destroyChart("toolChart");
    setPanelState("toolState", tools.error, true);
    return;
  }
  const entries = Object.entries(tools.counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (!entries.length) {
    destroyChart("toolChart");
    setPanelState("toolState", "No Claude Code tool calls found.");
    return;
  }
  makeChart("toolChart", {
    type: "bar",
    data: {
      labels: entries.map(([name]) => name.replace(/^mcp__/, "").slice(0, 28)),
      datasets: [{ data: entries.map(([, count]) => count), backgroundColor: PALETTE[3] }],
    },
    options: { indexAxis: "y", plugins: { legend: { display: false } } },
  }, "toolState", `Top ${entries.length} Claude Code tools used in the last 30 days`);
}

function renderConversations(conversations) {
  const list = byId("convs");
  if (conversations.error) {
    list.replaceChildren(element("li", "err", conversations.error));
    return;
  }
  if (!conversations.length) {
    list.replaceChildren(element("li", "empty", "No sessions found."));
    return;
  }
  const nodes = conversations.map((conversation) => {
    const row = element("li", "conv");
    const knownAgent = conversation.agent === "claude" || conversation.agent === "codex"
      ? conversation.agent : "other";
    const badge = element("span", `badge ${knownAgent}`, conversation.agent || "other");
    const project = element("span", "proj", conversation.project || "?");
    const title = element("span", "title", conversation.title || "Untitled conversation");
    title.title = conversation.title || "";
    row.append(badge, project, title, element("time", "when", ago(conversation.time)));
    return row;
  });
  list.replaceChildren(...nodes);
}

function memoryTimestamp(value) {
  if (!value) return "";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  return ago(normalized);
}

function renderMemories(memories) {
  const list = byId("mems");
  if (memories.error) {
    list.replaceChildren(element("li", "err", memories.error));
    return;
  }
  if (!memories.length) {
    list.replaceChildren(element("li", "empty", "No memories yet — agents save here via mem_save."));
    return;
  }
  const nodes = memories.map((memory) => {
    const row = element("li", "mem");
    const head = element("div", "head");
    head.append(
      element("span", "type", memory.type || "memory"),
      element("span", "title", memory.title || "Untitled memory"),
      element("time", "when", memoryTimestamp(memory.created_at)),
    );
    row.append(head);
    if (memory.project) row.append(element("div", "meta", memory.project));
    row.append(element("div", "body", memory.content || ""));
    return row;
  });
  list.replaceChildren(...nodes);
}

function replaceCards(id, items) {
  byId(id).replaceChildren(...items);
}

function advisorError(message) {
  for (const id of ["overviewState", "wasteState", "outcomeState", "knowledgeState"]) {
    setPanelState(id, message, true);
  }
}

function addLegend(container, className, label, value) {
  const item = element("span", "legend-item");
  item.append(element("span", `legend-dot ${className}`), element("span", "", `${label} ${formatDuration(value)}`));
  container.append(item);
}

function signalById(id) {
  if (!advisorData) return null;
  return [
    ...(advisorData.overview?.recommendations || []),
    ...(advisorData.friction?.signals || []),
    ...(advisorData.knowledge?.signals || []),
  ].find((item) => item.id === id) || null;
}

function draftKind(signal) {
  if (signal.type === "repeated_briefing") return "rule";
  if (signal.type === "failure_churn" || signal.type === "repeated_read") return "context";
  if (signal.type === "reusable_workflow") return "skill";
  if (signal.type === "source_review") return "checklist";
  return "decision";
}

function draftLabel(kind) {
  return ({ rule: "Draft rule", context: "Context pack", skill: "Create skill", checklist: "Review checklist", decision: "Capture decision" })[kind] || "Create draft";
}

function actionRows(id, items, context) {
  const container = byId(id);
  if (!items.length) {
    container.replaceChildren(element("p", "empty", context === "waste" ? "No repeated friction patterns met the evidence threshold." : "No actionable patterns yet."));
    return;
  }
  const nodes = items.map((item, index) => {
    const row = element("article", "action-row");
    const copy = element("div", "action-copy");
    copy.append(element("div", "action-title", context === "overview" ? `${index + 1}. ${item.title}` : item.title));
    copy.append(element("div", "action-detail", item.detail));
    const meta = element("div", "action-meta");
    meta.append(
      element("span", "", `${Math.round(number(item.confidence) * 100)}% confidence`),
      element("span", "", `${number(item.occurrences)} signal${number(item.occurrences) === 1 ? "" : "s"}`),
    );
    if (item.activeMs) meta.append(element("span", "", `~${formatDuration(item.activeMs)}`));
    copy.append(meta);
    const actions = element("div", "action-buttons");
    const kind = draftKind(item);
    const draft = element("button", context === "overview" && index === 0 ? "primary" : "", draftLabel(kind));
    draft.type = "button"; draft.dataset.action = "draft"; draft.dataset.signalId = item.id; draft.dataset.draftKind = kind;
    const evidence = element("button", "", "See evidence");
    evidence.type = "button"; evidence.dataset.action = "evidence"; evidence.dataset.signalId = item.id;
    actions.append(draft, evidence);
    row.append(copy, actions);
    return row;
  });
  container.replaceChildren(...nodes);
}

function renderOverview(data) {
  const metrics = data.overview.metrics;
  const coverage = data.coverage || {};
  const frictionValue = coverage.pricingPercent >= 50 && metrics.frictionCost > 0
    ? formatMoney(metrics.frictionCost) : formatDuration(metrics.frictionMs);
  replaceCards("overviewCards", [
    card("Outcome yield", `${metrics.outcomeYield}%`, `${metrics.outcomeCount} of ${metrics.eligibleSessions} sessions completed`),
    card("Estimated avoidable usage", frictionValue, coverage.pricingPercent >= 50 ? `${coverage.pricingPercent}% pricing coverage` : "time estimate · limited pricing coverage"),
    card("Memory-assisted sessions", metrics.memoryAssisted, "Engram recall preceded a completion signal"),
  ]);
  byId("advisorCoverage").textContent = `${coverage.matchedSessions || 0}/${coverage.totalSessions || 0} sessions matched to usage`;

  const allocation = data.overview.allocation;
  const bar = byId("allocationBar");
  const parts = [
    ["allocation-productive", allocation.productiveMs],
    ["allocation-exploration", allocation.explorationMs],
    ["allocation-friction", allocation.frictionMs],
  ].map(([className, value]) => {
    const node = element("span", className);
    node.style.width = `${percent(value, allocation.totalMs)}%`;
    return node;
  });
  bar.replaceChildren(...parts);
  bar.setAttribute("aria-label", `Estimated active time: ${formatDuration(allocation.productiveMs)} productive, ${formatDuration(allocation.explorationMs)} exploration, ${formatDuration(allocation.frictionMs)} friction`);
  const legend = byId("allocationLegend");
  legend.replaceChildren();
  addLegend(legend, "allocation-productive", "Productive", allocation.productiveMs);
  addLegend(legend, "allocation-exploration", "Exploration", allocation.explorationMs);
  addLegend(legend, "allocation-friction", "Friction", allocation.frictionMs);

  const fit = data.overview.planFit;
  const plan = byId("planFit");
  if (!fit.configured) {
    plan.replaceChildren(element("div", "plan-value", "Not configured"), element("p", "plan-copy", fit.recommendation));
  } else {
    plan.replaceChildren(
      element("div", "plan-value", formatMoney(fit.difference)),
      element("p", "plan-copy", `API-equivalent value above plan cost · ${fit.pricingPercent}% pricing coverage`),
      element("p", "plan-copy", fit.recommendation),
    );
  }
  actionRows("recommendations", data.overview.recommendations || [], "overview");
  setPanelState("overviewState", coverage.warnings?.length ? `${coverage.warnings.length} source coverage warning${coverage.warnings.length === 1 ? "" : "s"}.` : "");
}

function renderWaste(data) {
  const metrics = data.friction.metrics;
  replaceCards("wasteCards", [
    card("Estimated friction", formatDuration(metrics.frictionMs), "bounded active-time estimate"),
    card("Detected patterns", metrics.signals, "only signals above evidence thresholds"),
    card("Active AI time", formatDuration(metrics.totalActiveMs), `${data.coverage.pricingPercent || 0}% pricing coverage`),
  ]);
  actionRows("wasteSignals", data.friction.signals || [], "waste");
  setPanelState("wasteState");
}

function renderOutcomes(data) {
  const metrics = data.outcomes.metrics;
  replaceCards("outcomeCards", [
    card("Completed outcomes", metrics.outcomes, `${metrics.yieldPercent}% of eligible sessions`),
    card("Cost per priced outcome", metrics.costPerOutcome === null ? "—" : formatMoney(metrics.costPerOutcome), `${metrics.pricedOutcomes} priced outcome${metrics.pricedOutcomes === 1 ? "" : "s"}`),
    card("Worth resuming", metrics.paused, "manually marked paused sessions"),
  ]);
  const rows = (data.outcomes.sessions || []).map((session) => {
    const row = element("article", "ledger-row");
    const work = element("div", "");
    work.append(element("div", "ledger-title", session.title), element("div", "ledger-meta", `${session.agent} · ${session.project} · ${ago(session.lastActivityAt)}`));
    const status = element("div", "");
    status.append(element("span", `status-pill ${session.outcome.source === "manual" ? "manual" : ""}`, session.outcome.status));
    status.append(element("div", "ledger-meta", `${session.outcome.type} · ${Math.round(session.outcome.confidence * 100)}%`));
    const usage = element("div", "usage-meta", session.usage?.matched
      ? `${formatTokens(session.usage.totalTokens)} tokens · ${session.usage.priced ? formatMoney(session.usage.costUSD) : "unpriced"}`
      : "usage unmatched");
    const edit = element("button", "", "Edit");
    edit.type = "button"; edit.dataset.action = "outcome"; edit.dataset.sessionId = session.id;
    row.append(work, status, usage, edit);
    return row;
  });
  byId("outcomeLedger").replaceChildren(...(rows.length ? rows : [element("p", "empty", "No eligible sessions in this range.")]));
  setPanelState("outcomeState");
}

function renderKnowledge(data) {
  const metrics = data.knowledge.metrics;
  replaceCards("knowledgeCards", [
    card("Captured knowledge", metrics.captured, "successful memory saves in session logs"),
    card("Memory-assisted", metrics.assisted, "recall preceded a completion signal"),
    card("Suggested captures", metrics.suggested, "repeated context not yet saved"),
  ]);
  actionRows("knowledgeSignals", data.knowledge.signals || [], "knowledge");
  setPanelState("knowledgeState");
}

function renderAdvisor(data) {
  if (data.error) { advisorError(data.error); return; }
  advisorData = data;
  renderOverview(data);
  renderWaste(data);
  renderOutcomes(data);
  renderKnowledge(data);
}

function savingsRow(label, value, detail) {
  const row = element("div", "savings-row");
  row.append(element("strong", "", label), element("span", "", value));
  if (detail) row.append(element("small", "", detail));
  return row;
}

function renderSavings(data) {
  const status = data.status || {};
  const input = data.inputCompression || {};
  if (!status.installed) {
    replaceCards("savingsCards", [card("Headroom", "Not installed", "Run ./setup.sh --headroom claude,codex"), card("Measured reduction", "—", "available after proxied traffic"), card("Enabled agents", "None", "optional and off by default")]);
  } else if (!status.targets?.length) {
    replaceCards("savingsCards", [card("Headroom", `v${status.version}`, "ready, not enabled"), card("Measured reduction", "—", "select an agent in Settings"), card("Proxy", status.healthy ? "Healthy" : "Stopped", `cache-aware mode available`)]);
  } else {
    replaceCards("savingsCards", [
      card("Input tokens saved", formatTokens(input.tokensSaved), `${input.measurement || "measured"} · ${number(input.reductionPercent).toFixed(1)}% reduction`),
      card("Before → after", `${formatTokens(input.tokensBefore)} → ${formatTokens(input.tokensAfter)}`, `${data.coverage?.records || 0} proxied requests`),
      card("Enabled agents", status.targets.map((name) => name === "claude" ? "Claude" : "Codex").join(" + "), `${status.mode} mode · Headroom v${status.version}`),
    ]);
  }

  const health = byId("headroomHealth");
  health.replaceChildren(
    savingsRow("Installed", status.installed ? `v${status.version}` : "No"),
    savingsRow("Proxy", status.healthy ? "Healthy" : "Stopped"),
    savingsRow("Mode", status.mode || "cache"),
    savingsRow("Overhead", `${number(data.reliability?.averageOptimizationMs)} ms avg`),
  );
  const agentRows = (data.agents || []).map((agent) => savingsRow(
    agent.agent === "claude" ? "Claude Code" : agent.agent === "codex" ? "Codex" : "Unknown client",
    `${formatTokens(agent.tokensSaved)} saved · ${number(agent.reductionPercent).toFixed(1)}%`,
    `${agent.requests} requests · ${formatTokens(agent.tokensBefore)} before → ${formatTokens(agent.tokensAfter)} after`,
  ));
  byId("agentSavings").replaceChildren(...(agentRows.length ? agentRows : [element("p", "empty", status.targets?.length ? "No proxied requests in this range." : "Enable an agent to begin measuring.")]));
  const transforms = (data.transforms || []).slice(0, 6).map((item) => savingsRow(item.name.replaceAll("_", " "), `${item.uses} uses`));
  byId("headroomTransforms").replaceChildren(...(transforms.length ? transforms : [element("p", "empty", "No compression transforms recorded yet.")]));

  const daily = data.daily || [];
  if (daily.length) {
    makeChart("savingsChart", {
      type: "bar",
      data: { labels: daily.map((day) => day.date.slice(5)), datasets: [{ label: "Input tokens saved", data: daily.map((day) => day.tokensSaved), backgroundColor: PALETTE[3] }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: formatTokens } } } },
    }, "savingsChartState", `Measured daily Headroom input token savings across ${daily.length} days`);
  } else { destroyChart("savingsChart"); setPanelState("savingsChartState", status.targets?.length ? "No measured traffic in this range." : "Enable Headroom for an agent to begin measuring."); }
  const coverage = data.coverage || {};
  setPanelState("savingsState", data.error || (coverage.oldest ? `Coverage ${String(coverage.oldest).slice(0, 10)} to ${String(coverage.newest).slice(0, 10)}. Proxy compression is measured; cache and output effects are not included.` : ""), Boolean(data.error));
}

async function fetchJson(source, fresh) {
  const range = byId("range").value;
  const path = source === "advisor" || source === "headroom" ? `/api/${source}?range=${encodeURIComponent(range)}` : `/api/${source}`;
  const response = await fetch(`${path}${fresh ? (path.includes("?") ? "&fresh=1" : "?fresh=1") : ""}`);
  if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
  return response.json();
}

function settledValue(result, source) {
  return result.status === "fulfilled" ? result.value : { error: `Could not load ${source}.` };
}

async function load(fresh = false) {
  if (loadInFlight) return;
  loadInFlight = true;
  byId("status").textContent = fresh ? "refreshing…" : "loading…";
  byId("refresh").disabled = true;
  const sources = ["advisor", "headroom", "usage", "blocks", "tools", "conversations", "memories"];
  try {
    const results = await Promise.allSettled(sources.map((source) => fetchJson(source, fresh)));
    const data = Object.fromEntries(results.map((result, index) => [sources[index], settledValue(result, sources[index])]));
    renderAdvisor(data.advisor);
    renderSavings(data.headroom);
    renderSummaries(data.usage, data.blocks);
    renderUsageCharts(data.usage);
    renderTools(data.tools);
    renderConversations(data.conversations);
    renderMemories(data.memories);
    const failures = Object.values(data).filter((value) => value.error).length;
    byId("status").textContent = failures
      ? `updated with ${failures} ${failures === 1 ? "issue" : "issues"}`
      : `updated ${new Date().toLocaleTimeString()}`;
  } catch {
    byId("status").textContent = "refresh failed — try again";
  } finally {
    loadInFlight = false;
    byId("refresh").disabled = false;
  }
}

function selectView(name, updateHash = true) {
  const valid = ["overview", "waste", "outcomes", "knowledge", "savings", "usage"];
  const selected = valid.includes(name) ? name : "overview";
  document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === selected)));
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== selected; });
  if (updateHash && location.hash !== `#${selected}`) history.pushState(null, "", `#${selected}`);
}

function showDialog(id) {
  const dialog = byId(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = byId(id);
  if (dialog.open) dialog.close();
}

async function evidenceFor(id) {
  const response = await fetch(`/api/advisor/evidence?range=${encodeURIComponent(byId("range").value)}&id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Could not load evidence.");
  return response.json();
}

async function openEvidence(id) {
  const signal = signalById(id);
  byId("evidenceTitle").textContent = signal?.title || "Evidence";
  byId("evidenceDetail").textContent = signal?.detail || "";
  byId("evidenceList").replaceChildren(element("li", "empty", "Loading evidence…"));
  showDialog("evidenceDialog");
  try {
    const result = await evidenceFor(id);
    const nodes = result.evidence.map((item) => {
      const row = element("li");
      row.append(element("strong", "", item.label || "Evidence"), element("p", "", item.excerpt || ""), element("time", "when", ago(item.at)));
      return row;
    });
    byId("evidenceList").replaceChildren(...(nodes.length ? nodes : [element("li", "empty", "No evidence excerpt available.")]));
  } catch (error) {
    byId("evidenceList").replaceChildren(element("li", "err", error.message));
  }
}

function makeDraft(kind, signal, evidence) {
  const lines = evidence.map((item) => `- ${item.label}: ${item.excerpt}`).join("\n");
  if (kind === "rule") return `# Proposed AGENTS.md rule\n\n## Rule\nBefore working in ${signal.projects.join(", ")}, load and follow the established repository test and workflow conventions.\n\n## Why\n${signal.detail}\n\n## Evidence\n${lines}`;
  if (kind === "context") return `# Context pack\n\n## Project\n${signal.projects.join(", ")}\n\n## Observed friction\n${signal.detail}\n\n## Relevant evidence\n${lines}\n\n## Next action\nResume from the last successful step and avoid rereading unchanged context.`;
  if (kind === "skill") return `# Reusable workflow skill\n\n## Trigger\nUse for repeated ${signal.projects.join(", ")} work.\n\n## Workflow\n1. Load the project context and prior decisions.\n2. Execute the observed successful tool sequence.\n3. Verify the result with the project test command.\n4. Capture the outcome and reusable decisions.\n\n## Evidence\n${lines}`;
  if (kind === "checklist") return `# Source verification checklist\n\n${evidence.map((item) => `- [ ] Review ${item.excerpt}`).join("\n")}`;
  return `# Decision capture\n\n## Decision\n[State the decision]\n\n## Reason\n${signal.detail}\n\n## Alternatives considered\n- [Add rejected alternative]\n\n## Evidence\n${lines}`;
}

async function openDraft(id, kind) {
  const signal = signalById(id);
  byId("draftTitle").textContent = draftLabel(kind);
  byId("draftText").value = "Loading evidence…";
  byId("draftState").textContent = "";
  showDialog("draftDialog");
  try {
    const result = await evidenceFor(id);
    lastEvidence = result.evidence;
    byId("draftText").value = makeDraft(kind, signal, result.evidence);
  } catch (error) {
    byId("draftText").value = "";
    byId("draftState").textContent = error.message;
  }
}

async function mutate(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-LLM-Ground-Zero-Action": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save changes.");
  return result;
}

function openOutcomeEditor(id) {
  const session = advisorData?.outcomes.sessions.find((item) => item.id === id);
  if (!session) return;
  byId("outcomeSessionId").value = id;
  byId("outcomeStatus").value = session.outcome.status;
  byId("outcomeType").value = session.outcome.type;
  byId("outcomeNote").value = session.outcome.note || "";
  byId("outcomeFormState").textContent = "";
  showDialog("outcomeDialog");
}

function subscriptionRow(value = {}) {
  const row = element("div", "subscription-row");
  for (const [label, name, type, fieldValue] of [
    ["Provider", "provider", "text", value.provider || ""], ["Plan", "plan", "text", value.plan || ""],
    ["Monthly", "monthlyPrice", "number", value.monthlyPrice ?? ""], ["Currency", "currency", "text", value.currency || "USD"],
  ]) {
    const wrapper = element("label", "", label);
    const input = element("input"); input.name = name; input.type = type; input.value = fieldValue;
    if (type === "number") { input.min = "0"; input.step = "0.01"; input.required = true; }
    else input.required = true;
    wrapper.append(input); row.append(wrapper);
  }
  const remove = element("button", "", "Remove"); remove.type = "button"; remove.dataset.action = "remove-plan";
  row.append(remove);
  return row;
}

async function openSettings() {
  byId("settingsState").textContent = "";
  byId("headroomSettingsState").textContent = "";
  showDialog("settingsDialog");
  try {
    const [plansResponse, headroomResponse] = await Promise.all([fetch("/api/advisor/settings"), fetch("/api/headroom/status")]);
    const data = await plansResponse.json(); headroomSettings = await headroomResponse.json();
    const rows = (data.subscriptions || []).map(subscriptionRow);
    byId("subscriptionRows").replaceChildren(...(rows.length ? rows : [subscriptionRow()]));
    byId("headroomClaude").checked = headroomSettings.targets?.includes("claude");
    byId("headroomCodex").checked = headroomSettings.targets?.includes("codex");
    byId("headroomMode").value = headroomSettings.mode || "cache";
    const usable = headroomSettings.installed && headroomSettings.compatible;
    for (const id of ["headroomClaude", "headroomCodex", "headroomMode"]) byId(id).disabled = !usable;
    if (!usable) byId("headroomSettingsState").textContent = headroomSettings.installed ? "Headroom 0.31.0 or newer is required." : "Not installed. Run ./setup.sh --headroom claude,codex.";
  } catch {
    byId("settingsState").textContent = "Could not load plan settings.";
  }
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.view)));
window.addEventListener("hashchange", () => selectView(location.hash.slice(1), false));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "evidence") openEvidence(button.dataset.signalId);
  else if (button.dataset.action === "draft") openDraft(button.dataset.signalId, button.dataset.draftKind);
  else if (button.dataset.action === "outcome") openOutcomeEditor(button.dataset.sessionId);
  else if (button.dataset.action === "settings") openSettings();
  else if (button.dataset.action === "remove-plan") button.closest(".subscription-row").remove();
});

byId("copyDraft").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(byId("draftText").value);
    byId("draftState").textContent = "Copied to clipboard.";
  } catch { byId("draftState").textContent = "Clipboard unavailable; select and copy the draft manually."; }
});

byId("outcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = byId("outcomeSessionId").value;
  try {
    await mutate(`/api/advisor/outcomes/${encodeURIComponent(id)}`, "PUT", {
      status: byId("outcomeStatus").value, type: byId("outcomeType").value, note: byId("outcomeNote").value,
    });
    closeDialog("outcomeDialog");
    await load(true);
  } catch (error) { byId("outcomeFormState").textContent = error.message; }
});

byId("clearOutcome").addEventListener("click", async () => {
  try {
    await mutate(`/api/advisor/outcomes/${encodeURIComponent(byId("outcomeSessionId").value)}`, "DELETE");
    closeDialog("outcomeDialog");
    await load(true);
  } catch (error) { byId("outcomeFormState").textContent = error.message; }
});

byId("addSubscription").addEventListener("click", () => byId("subscriptionRows").append(subscriptionRow()));
byId("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const subscriptions = [...byId("subscriptionRows").querySelectorAll(".subscription-row")].map((row) => ({
    provider: row.querySelector('[name="provider"]').value,
    plan: row.querySelector('[name="plan"]').value,
    monthlyPrice: number(row.querySelector('[name="monthlyPrice"]').value),
    currency: row.querySelector('[name="currency"]').value,
  }));
  try {
    const targets = [];
    if (byId("headroomClaude").checked) targets.push("claude");
    if (byId("headroomCodex").checked) targets.push("codex");
    if (headroomSettings?.installed && headroomSettings.compatible) await mutate("/api/headroom/settings", "PUT", { targets, mode: byId("headroomMode").value });
    await mutate("/api/advisor/settings", "PUT", { subscriptions });
    closeDialog("settingsDialog");
    await load(true);
  } catch (error) { byId("settingsState").textContent = error.message; }
});

byId("refresh").addEventListener("click", () => load(true));
byId("range").addEventListener("change", () => load(true));
selectView(location.hash.slice(1) || "overview", false);
load();
setInterval(() => load(false), 120000);
