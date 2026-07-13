"use strict";

const { analyzeFriction } = require("./friction");
const { analyzeKnowledge } = require("./knowledge");
const { outcomeLedger, metrics: outcomeMetrics } = require("./outcomes");
const { buildSummary } = require("./summary");

function publicSession(session) {
  return {
    id: session.id, agent: session.agent, project: session.project, title: session.title,
    startedAt: session.startedAt, lastActivityAt: session.lastActivityAt,
    usage: session.usage, outcome: session.outcome,
  };
}

function analyze({ sessions, memories = [], state = {}, rangeDays = 7, coverage = {} }) {
  const ledger = outcomeLedger(sessions, state.outcomes || {});
  const friction = analyzeFriction(ledger);
  const knowledge = analyzeKnowledge(ledger, friction, memories);
  const overview = buildSummary({
    ledger, friction, knowledge, subscriptions: state.subscriptions || [], rangeDays,
    pricingCoverage: coverage.pricingPercent || 0,
  });
  const allSignals = [...friction.signals, ...knowledge.signals];
  return {
    generatedAt: new Date().toISOString(), range: `${rangeDays}d`, coverage,
    overview,
    friction: { metrics: { totalActiveMs: friction.totalActiveMs, frictionMs: friction.frictionMs, signals: friction.signals.length }, signals: friction.signals.map(({ evidence, ...item }) => item) },
    outcomes: { metrics: outcomeMetrics(ledger), sessions: ledger.map(publicSession) },
    knowledge: { metrics: knowledge.metrics, signals: knowledge.signals.map(({ evidence, ...item }) => item) },
    evidence: Object.fromEntries(allSignals.map((item) => [item.id, item.evidence])),
  };
}

module.exports = { analyze };
