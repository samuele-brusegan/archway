const { randomUUID } = require('node:crypto');
const { db } = require('./db');
const { perception, executeCommand, narrativeContext } = require('./state');
const { validateContract, ContractError } = require('./contracts');
const { simulate } = require('./ai-simulator');
const { interpretUserInput, narrateTurn } = require('./ollama');

const maxAttempts = Math.max(1, Number(process.env.TURN_MAX_ATTEMPTS || 2));
const campaignLocks = new Map();
const now = () => new Date().toISOString();

class TurnError extends Error {
  constructor(message, code, status = 409, traceId = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.traceId = traceId;
  }
}

const parseJson = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

const createTrace = ({ campaignId, actorId, inputText }) => {
  const id = randomUUID();
  const timestamp = now();
  const initialTrace = JSON.stringify([{ stage: 'received', at: timestamp, inputText }]);
  db.prepare(`INSERT INTO turn_traces
    (id, campaign_id, actor_id, input_text, status, current_stage, attempts, trace_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, campaignId, actorId || null, inputText, 'received', 'received', 0, initialTrace, timestamp, timestamp);
  return id;
};

const appendTrace = (traceId, stage, data = {}) => {
  const current = db.prepare('SELECT trace_json FROM turn_traces WHERE id = ?').get(traceId);
  const trace = parseJson(current?.trace_json, []);
  trace.push({ stage, at: now(), ...data });
  db.prepare(`UPDATE turn_traces SET current_stage = ?, trace_json = ?, updated_at = ? WHERE id = ?`)
    .run(stage, JSON.stringify(trace), now(), traceId);
};

const setTrace = (traceId, changes) => {
  db.prepare(`UPDATE turn_traces SET ${Object.keys(changes).map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...Object.values(changes), now(), traceId);
};

const failTrace = (traceId, error) => {
  appendTrace(traceId, 'failed', { code: error.code || 'TURN_FAILED', error: error.message });
  setTrace(traceId, { status: 'failed', error_json: JSON.stringify({ code: error.code || 'TURN_FAILED', message: error.message }) });
};

const getTrace = (traceId) => {
  const row = db.prepare('SELECT * FROM turn_traces WHERE id = ?').get(traceId);
  if (!row) return null;
  return { ...row, trace: parseJson(row.trace_json, []), result: row.result_json ? parseJson(row.result_json, null) : null, error: row.error_json ? parseJson(row.error_json, null) : null };
};

const listTraces = (campaignId, limit = 50) => db.prepare(`SELECT id, campaign_id, actor_id, input_text, status, current_stage, attempts, created_at, updated_at
  FROM turn_traces WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?`).all(campaignId, Math.max(1, Math.min(200, Number(limit) || 50)));

const withCampaignLock = async (campaignId, work) => {
  const previous = campaignLocks.get(campaignId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  campaignLocks.set(campaignId, current);
  await previous;
  try { return await work(); } finally {
    release();
    if (campaignLocks.get(campaignId) === current) campaignLocks.delete(campaignId);
  }
};

const callWithAttempts = async (traceId, task, call, fallback) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    setTrace(traceId, { attempts: attempt });
    try {
      const value = await call();
      appendTrace(traceId, task, { attempt, outcome: 'ok', value });
      return value;
    } catch (error) {
      lastError = error;
      appendTrace(traceId, task, { attempt, outcome: 'error', error: error.message });
    }
  }
  if (fallback) {
    const value = fallback(lastError);
    appendTrace(traceId, `${task}.fallback`, { reason: lastError?.message, value });
    return value;
  }
  throw lastError;
};

const safeNarrativeFallback = (execution) => execution.events.length
  ? "L'azione viene eseguita e il mondo registra la conseguenza."
  : 'Non accade nulla di nuovo.';

const runUserTurnUnlocked = async ({ campaignId, actorId, text, narratorMessage = '', traceId: resumedTraceId = null, resumedIntent = null, resumedExecution = null }) => {
  if (typeof actorId !== 'string' || !actorId.trim()) throw new TurnError('actorId is required', 'ACTOR_REQUIRED', 400);
  if (typeof text !== 'string' || !text.trim()) throw new TurnError('text is required', 'TEXT_REQUIRED', 400);
  const traceId = resumedTraceId || createTrace({ campaignId, actorId, inputText: text });
  try {
    let intent = resumedIntent;
    let execution = resumedExecution;
    if (intent && execution) {
      appendTrace(traceId, 'resumed', { from: 'applied', reason: 'Narration resumed without reapplying the command' });
    } else {
      const available = perception(campaignId, actorId);
      const rawIntent = await callWithAttempts(traceId, 'interpreted',
        () => interpretUserInput({ actorId, text, perception: available }),
        () => simulate('interpret', { actorId, text }));
      intent = (() => {
        try {
          const value = validateContract('intent', rawIntent);
          appendTrace(traceId, 'validated', { value });
          return value;
        } catch (error) {
          throw new TurnError(`${error.message} at ${error.path || '$'}`, error.code || 'INVALID_INTENT', 422, traceId);
        }
      })();
      if (intent.confidence < 0.45) throw new TurnError('Input not understood with sufficient confidence', 'LOW_CONFIDENCE', 422, traceId);
      appendTrace(traceId, 'simulated', { action: intent.action });
      const command = { ...intent };
      delete command.type;
      delete command.confidence;
      execution = executeCommand(campaignId, command);
      appendTrace(traceId, 'applied', { execution });
    }
    let narrative;
    let narrativeFallback = false;
    let narrativeError = null;
    try {
      const context = narrativeContext(campaignId, actorId, text);
      narrative = await callWithAttempts(traceId, 'narrated',
        () => narrateTurn({ inputText: text, narratorMessage, actorName: context.actor.name, context, execution }),
        (error) => { narrativeFallback = true; narrativeError = error.message; return safeNarrativeFallback(execution); });
    } catch (error) {
      narrativeFallback = true;
      narrativeError = error.message;
      narrative = safeNarrativeFallback(execution);
    }
    const result = { traceId, intent, execution, narrative, narrativeFallback, ...(narrativeError ? { narrativeError } : {}) };
    appendTrace(traceId, 'narrated.result', { fallback: narrativeFallback, narrative });
    setTrace(traceId, { status: 'narrated', result_json: JSON.stringify(result) });
    return result;
  } catch (error) {
    const failure = error instanceof TurnError ? error : new TurnError(error.message, error.code || 'TURN_FAILED', 409, traceId);
    failTrace(traceId, failure);
    failure.traceId = traceId;
    throw failure;
  }
};

const runUserTurn = (input) => withCampaignLock(input.campaignId, () => runUserTurnUnlocked(input));

const resumeTurn = (traceId) => {
  const trace = getTrace(traceId);
  if (!trace) throw new TurnError('Turn trace not found', 'TRACE_NOT_FOUND', 404, traceId);
  if (trace.status === 'narrated' && trace.result) return Promise.resolve(trace.result);
  const applied = trace.trace.find((entry) => entry.stage === 'applied' && entry.execution);
  const validated = trace.trace.find((entry) => entry.stage === 'validated' && entry.value);
  return withCampaignLock(trace.campaign_id, () => runUserTurnUnlocked({
    campaignId: trace.campaign_id,
    actorId: trace.actor_id,
    text: trace.input_text,
    traceId,
    resumedIntent: applied && validated ? applied.execution && validated.value : null,
    resumedExecution: applied ? applied.execution : null,
  }));
};

module.exports = { TurnError, getTrace, listTraces, resumeTurn, runUserTurn };
