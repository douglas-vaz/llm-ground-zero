"use strict";

const VALID_STATUS = new Set(["shipped", "completed", "paused", "abandoned", "unreviewed"]);
const VALID_TYPE = new Set(["code", "research", "document", "prototype", "operations", "other"]);

function inferredType(session) {
  const categories = new Set(session.events.map((event) => event.category));
  if (categories.has("commit") || categories.has("pull_request") || categories.has("test") || categories.has("build")) return "code";
  if (categories.has("release")) return "operations";
  if (/research|compare|source|market/i.test(session.title)) return "research";
  if (/prototype/i.test(session.title)) return "prototype";
  if (/document|brief|spec|report/i.test(session.title)) return "document";
  return "other";
}

function inferOutcome(session) {
  const successful = session.events.filter((event) => event.kind === "tool_result" && event.status === "success");
  const shipped = successful.find((event) => ["commit", "pull_request", "release"].includes(event.category));
  if (shipped) return { status: "shipped", type: inferredType(session), confidence: 0.9, source: "evidence", evidenceIds: [shipped.id] };
  const verification = successful.find((event) => ["test", "build"].includes(event.category));
  const final = session.events.findLast((event) => event.kind === "assistant");
  if (verification && final && String(final.at) >= String(verification.at)) {
    return { status: "completed", type: inferredType(session), confidence: 0.7, source: "evidence", evidenceIds: [verification.id, final.id] };
  }
  return { status: "unreviewed", type: inferredType(session), confidence: 0, source: "none", evidenceIds: [] };
}

function outcomeLedger(sessions, annotations = {}) {
  return sessions.map((session) => {
    const inferred = inferOutcome(session);
    const manual = annotations[session.id];
    const outcome = manual && VALID_STATUS.has(manual.status) && VALID_TYPE.has(manual.type)
      ? { status: manual.status, type: manual.type, confidence: 1, source: "manual", evidenceIds: [], note: manual.note || "" }
      : inferred;
    return { ...session, outcome };
  });
}

function metrics(ledger) {
  const eligible = ledger.length;
  const outcomes = ledger.filter((session) => session.outcome.confidence >= 0.7
    && ["shipped", "completed"].includes(session.outcome.status));
  const priced = outcomes.filter((session) => session.usage?.priced);
  const pricedCost = priced.reduce((sum, session) => sum + session.usage.costUSD, 0);
  return {
    eligible, outcomes: outcomes.length,
    yieldPercent: eligible ? Math.round(100 * outcomes.length / eligible) : 0,
    costPerOutcome: priced.length ? pricedCost / priced.length : null,
    pricedOutcomes: priced.length,
    paused: ledger.filter((session) => session.outcome.status === "paused").length,
  };
}

module.exports = { VALID_STATUS, VALID_TYPE, inferOutcome, outcomeLedger, metrics };
