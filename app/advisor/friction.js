"use strict";

const { hash } = require("./parsers");

function normalizePrompt(value) {
  return String(value || "")
    .normalize("NFKC").toLowerCase()
    .replace(/(?:[a-z]:)?[\\/](?:[^\s/\\]+[\\/])*[^\s/\\]+/gi, " <path> ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, " <id> ")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:t[^\s]+)?\b/gi, " <date> ")
    .replace(/\b\d{4,}\b/g, " <number> ")
    .replace(/[^\p{L}\p{N}<>]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function shingles(value, size = 3) {
  const words = normalizePrompt(value).split(" ").filter(Boolean);
  const set = new Set();
  for (let index = 0; index <= words.length - size; index += 1) set.add(words.slice(index, index + size).join(" "));
  return set;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection || 1);
}

function activeTime(session) {
  const times = session.events.map((event) => new Date(event.at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  let total = 0;
  for (let index = 1; index < times.length; index += 1) total += Math.max(0, Math.min(5 * 60_000, times[index] - times[index - 1]));
  return total;
}

function evidence(session, event, label) {
  return { sessionId: session.id, eventId: event.id, at: event.at, label, excerpt: event.text || session.title };
}

function signal(type, title, sessions, events, confidence, detail) {
  const ids = sessions.map((session) => session.id).sort();
  return {
    id: hash(`${type}:${ids.join(":")}:${detail}`), type, title, confidence,
    occurrences: events.length, projects: [...new Set(sessions.map((session) => session.project))],
    sessionIds: ids, detail,
    evidence: events.map(({ session, event, label }) => evidence(session, event, label)),
  };
}

function repeatedBriefings(sessions) {
  const prompts = sessions.flatMap((session) => session.events
    .filter((event) => event.kind === "prompt" && normalizePrompt(event.text).length >= 40)
    .map((event) => ({ session, event, grams: shingles(event.text) })));
  const used = new Set();
  const signals = [];
  for (let index = 0; index < prompts.length; index += 1) {
    if (used.has(index)) continue;
    const seed = prompts[index];
    const cluster = [seed];
    for (let other = index + 1; other < prompts.length; other += 1) {
      if (seed.session.project === prompts[other].session.project
          && seed.session.id !== prompts[other].session.id
          && jaccard(seed.grams, prompts[other].grams) >= 0.65) cluster.push(prompts[other]);
    }
    const distinct = [...new Set(cluster.map((item) => item.session.id))];
    if (distinct.length >= 3) {
      cluster.forEach((item) => used.add(prompts.indexOf(item)));
      signals.push(signal("repeated_briefing", "Repeated repository briefing",
        cluster.map((item) => item.session), cluster.map((item) => ({ ...item, label: "Similar briefing" })),
        Math.min(0.95, 0.65 + distinct.length * 0.05), `${distinct.length} sessions repeat substantially similar context.`));
    }
  }
  return signals;
}

function perSessionSignals(session) {
  const signals = [];
  const failures = session.events.filter((event) => event.kind === "tool_result" && event.status === "failure");
  const reads = session.events.filter((event) => event.kind === "tool_result" && event.category === "read" && event.file);
  const byFile = Map.groupBy ? Map.groupBy(reads, (event) => event.file) : reads.reduce((map, event) => map.set(event.file, [...(map.get(event.file) || []), event]), new Map());
  for (const [file, events] of byFile) {
    if (events.length >= 3) signals.push(signal("repeated_read", "Repeated file reads", [session], events.map((event) => ({ session, event, label: "Repeated read" })), 0.8, `${events.length} reads of ${file.split(/[\\/]/).at(-1)}.`));
  }
  if (failures.length) {
    const afterFailureReads = reads.filter((event) => failures.some((failure) => String(event.at) >= String(failure.at)));
    if (afterFailureReads.length >= 2) {
      const events = [failures[0], ...afterFailureReads];
      signals.push(signal("failure_churn", "Context churn after a tool failure", [session], events.map((event) => ({ session, event, label: event.status === "failure" ? "Failure" : "Recovery reread" })), 0.85, `${afterFailureReads.length} file reads followed a failed tool call.`));
    }
  }
  const reverts = session.events.filter((event) => event.category === "revert" && event.status === "success");
  if (reverts.length) signals.push(signal("explicit_revert", "AI-assisted changes were explicitly reverted", [session], reverts.map((event) => ({ session, event, label: "Successful rollback" })), 0.95, `${reverts.length} explicit rollback command${reverts.length === 1 ? "" : "s"}.`));
  return signals;
}

function analyzeFriction(sessions) {
  const signals = [...repeatedBriefings(sessions), ...sessions.flatMap(perSessionSignals)];
  const totalActiveMs = sessions.reduce((sum, session) => sum + activeTime(session), 0);
  for (const item of signals) {
    const affected = sessions.filter((session) => item.sessionIds.includes(session.id));
    const affectedActive = affected.reduce((sum, session) => sum + activeTime(session), 0);
    item.activeMs = Math.min(affectedActive, item.occurrences * 5 * 60_000);
    item.attributableCost = affected.reduce((sum, session) => {
      if (!session.usage?.priced) return sum;
      const sessionActive = activeTime(session);
      const share = sessionActive ? Math.min(1, item.activeMs / Math.max(1, affected.length) / sessionActive) : 0;
      return sum + session.usage.costUSD * share;
    }, 0);
  }
  const frictionMs = Math.min(totalActiveMs, signals.reduce((sum, item) => sum + item.activeMs, 0));
  return { signals: signals.sort((a, b) => (b.activeMs * b.confidence) - (a.activeMs * a.confidence)), totalActiveMs, frictionMs };
}

module.exports = { normalizePrompt, shingles, jaccard, activeTime, analyzeFriction };
