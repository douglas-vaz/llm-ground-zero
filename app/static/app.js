"use strict";

const byId = (id) => document.getElementById(id);
const PALETTE = ["#58a6ff", "#d29922", "#bc8cff", "#3fb950", "#f85149", "#39c5cf", "#db61a2"];
const charts = new Map();
let loadInFlight = false;

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

async function fetchJson(source, fresh) {
  const response = await fetch(`/api/${source}${fresh ? "?fresh=1" : ""}`);
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
  const sources = ["usage", "blocks", "tools", "conversations", "memories"];
  try {
    const results = await Promise.allSettled(sources.map((source) => fetchJson(source, fresh)));
    const data = Object.fromEntries(results.map((result, index) => [sources[index], settledValue(result, sources[index])]));
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

byId("refresh").addEventListener("click", () => load(true));
load();
setInterval(() => load(false), 120000);
