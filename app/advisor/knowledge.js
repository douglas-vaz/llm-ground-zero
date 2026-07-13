"use strict";

const { hash } = require("./parsers");

function successful(session, category) {
  return session.events.filter((event) => event.kind === "tool_result" && event.status === "success" && event.category === category);
}

function workflowSignals(ledger) {
  const groups = new Map();
  for (const session of ledger.filter((item) => ["shipped", "completed"].includes(item.outcome.status))) {
    const sequence = session.events.filter((event) => event.kind === "tool_result" && event.status === "success")
      .map((event) => event.category).filter((category) => category !== "other").slice(0, 8);
    if (sequence.length < 3) continue;
    const key = `${session.project}:${sequence.join(">")}`;
    groups.set(key, [...(groups.get(key) || []), session]);
  }
  return [...groups.entries()].filter(([, sessions]) => sessions.length >= 3).map(([key, sessions]) => ({
    id: hash(`workflow:${key}`), type: "reusable_workflow", title: "Reusable workflow detected",
    confidence: 0.8, occurrences: sessions.length, projects: [sessions[0].project],
    sessionIds: sessions.map((session) => session.id),
    detail: `The same ${key.split(":")[1].split(">").length}-step tool pattern completed ${sessions.length} sessions.`,
    evidence: sessions.map((session) => ({ sessionId: session.id, label: "Completed workflow", excerpt: session.title, at: session.lastActivityAt })),
  }));
}

function analyzeKnowledge(ledger, friction, memories = [], now = Date.now()) {
  const captured = ledger.reduce((sum, session) => sum + successful(session, "memory_save").length, 0);
  const assisted = ledger.filter((session) => {
    const recalls = successful(session, "memory_recall");
    if (!recalls.length || !["shipped", "completed"].includes(session.outcome.status)) return false;
    const completionAt = session.events.findLast((event) => event.kind === "assistant")?.at || session.lastActivityAt;
    return recalls.some((event) => String(event.at) <= String(completionAt));
  });
  const suggested = friction.signals.filter((item) => ["repeated_briefing", "repeated_decision"].includes(item.type))
    .filter((item) => !ledger.some((session) => item.sessionIds.includes(session.id) && successful(session, "memory_save").length));
  const reviewDue = memories.flatMap((memory) => {
    const age = now - new Date(String(memory.created_at || "").replace(" ", "T") + (String(memory.created_at || "").includes("T") ? "" : "Z")).getTime();
    const urls = String(memory.content || "").match(/https?:\/\/[^\s)]+/g) || [];
    if (age < 90 * 86400_000 || !urls.length) return [];
    return [{
      id: hash(`review:${memory.id || memory.title}`), type: "source_review", title: "Saved sources are due for review",
      confidence: 1, occurrences: urls.length, projects: [memory.project || "personal"], sessionIds: [],
      detail: `${urls.length} saved source${urls.length === 1 ? " is" : "s are"} older than 90 days.`,
      evidence: urls.slice(0, 5).map((url) => ({ label: "Saved source", excerpt: url, at: memory.created_at })),
    }];
  });
  return {
    metrics: { captured, assisted: assisted.length, suggested: suggested.length },
    signals: [...suggested, ...workflowSignals(ledger), ...reviewDue],
  };
}

module.exports = { analyzeKnowledge, workflowSignals };
