const { randomUUID } = require('node:crypto');
const { db } = require('./db');

const memoryTypes = new Set(['fact', 'opinion', 'rumor', 'suspicion', 'memory', 'goal', 'secret']);
const sources = new Set(['user', 'narrator', 'event', 'character']);
const statuses = new Set(['active', 'superseded', 'contradicted', 'archived']);
const now = () => new Date().toISOString();

const requireCharacter = (campaignId, characterId) => {
  const result = db.prepare('SELECT id FROM characters WHERE id = ? AND campaign_id = ?').get(characterId, campaignId);
  if (!result) throw new Error('Character not found');
};

const normalizeMemory = (input) => {
  if (!input || typeof input.content !== 'string' || !input.content.trim()) throw new Error('content is required');
  const type = input.type || 'fact';
  const source = input.source || 'user';
  const status = input.status || 'active';
  if (!memoryTypes.has(type)) throw new Error('Invalid memory type');
  if (!sources.has(source)) throw new Error('Invalid memory source');
  if (!statuses.has(status)) throw new Error('Invalid memory status');
  const reliability = input.reliability === undefined ? 1 : Number(input.reliability);
  const importance = input.importance === undefined ? 50 : Number(input.importance);
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 1) throw new Error('reliability must be between 0 and 1');
  if (!Number.isInteger(importance) || importance < 0 || importance > 100) throw new Error('importance must be between 0 and 100');
  return { content: input.content.trim(), type, source, status, reliability, importance, locationId: input.locationId || null, occurredAt: input.occurredAt || null };
};

const createMemory = (campaignId, characterId, input) => {
  requireCharacter(campaignId, characterId);
  const value = normalizeMemory(input);
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO memories (id, campaign_id, character_id, content, type, source, reliability, importance, status, location_id, occurred_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, characterId, value.content, value.type, value.source, value.reliability, value.importance, value.status, value.locationId, value.occurredAt, timestamp, timestamp);
  return getMemory(campaignId, characterId, id);
};

const listMemories = (campaignId, characterId, includeArchived = false) => {
  requireCharacter(campaignId, characterId);
  const archivedClause = includeArchived ? '' : " AND status != 'archived'";
  return db.prepare(`SELECT * FROM memories WHERE campaign_id = ? AND character_id = ?${archivedClause} ORDER BY importance DESC, updated_at DESC`).all(campaignId, characterId);
};

const getMemory = (campaignId, characterId, memoryId) => {
  requireCharacter(campaignId, characterId);
  const result = db.prepare('SELECT * FROM memories WHERE id = ? AND campaign_id = ? AND character_id = ?').get(memoryId, campaignId, characterId);
  if (!result) throw new Error('Memory not found');
  return result;
};

const updateMemory = (campaignId, characterId, memoryId, input) => {
  const current = getMemory(campaignId, characterId, memoryId);
  const value = normalizeMemory({ ...current, ...input });
  const timestamp = now();
  db.prepare(`UPDATE memories SET content = ?, type = ?, source = ?, reliability = ?, importance = ?, status = ?, location_id = ?, occurred_at = ?, updated_at = ?
    WHERE id = ? AND campaign_id = ? AND character_id = ?`).run(value.content, value.type, value.source, value.reliability, value.importance, value.status, value.locationId, value.occurredAt, timestamp, memoryId, campaignId, characterId);
  return getMemory(campaignId, characterId, memoryId);
};

const archiveMemory = (campaignId, characterId, memoryId) => updateMemory(campaignId, characterId, memoryId, { status: 'archived' });

const estimateTokens = (text) => Math.max(1, Math.ceil(String(text).length / 4));

const relevantMemoryContext = (campaignId, characterId, { query = '', locationId = null, limit = 20, tokenBudget = 1200 } = {}) => {
  const records = listMemories(campaignId, characterId).map((record) => {
    const terms = String(query).toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    const haystack = record.content.toLowerCase();
    const termScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0), 0);
    const locationScore = locationId && record.location_id === locationId ? 5 : 0;
    const ageDays = Math.max(0, (Date.now() - Date.parse(record.updated_at)) / 86400000);
    const recencyScore = Math.max(0, 3 - ageDays / 30);
    const score = record.importance / 20 + termScore + locationScore + recencyScore + (record.type === 'fact' ? 1 : 0);
    return { ...record, score, estimatedTokens: estimateTokens(record.content) + 8 };
  }).sort((a, b) => b.score - a.score || b.importance - a.importance);
  const selected = [];
  let estimatedTokens = 0;
  for (const record of records.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))) {
    if (estimatedTokens + record.estimatedTokens > tokenBudget && selected.length) continue;
    selected.push(record);
    estimatedTokens += record.estimatedTokens;
    if (estimatedTokens >= tokenBudget) break;
  }
  return { records: selected, estimatedTokens, tokenBudget };
};

const saveSummary = (campaignId, scopeType, scopeId, summary, tokenBudget = 1000) => {
  if (!['scene', 'arc', 'campaign', 'character'].includes(scopeType)) throw new Error('Invalid summary scope');
  const timestamp = now();
  const id = randomUUID();
  db.prepare(`INSERT INTO context_summaries (id, campaign_id, scope_type, scope_id, summary_json, token_budget, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, scope_type, scope_id) DO UPDATE SET summary_json = excluded.summary_json, token_budget = excluded.token_budget, updated_at = excluded.updated_at`)
    .run(id, campaignId, scopeType, scopeId || null, JSON.stringify(summary), tokenBudget, timestamp, timestamp);
  return getSummary(campaignId, scopeType, scopeId);
};

const getSummary = (campaignId, scopeType, scopeId = null) => {
  const result = db.prepare('SELECT * FROM context_summaries WHERE campaign_id = ? AND scope_type = ? AND scope_id IS ?').get(campaignId, scopeType, scopeId);
  if (!result) return null;
  return { ...result, summary: JSON.parse(result.summary_json) };
};

const buildCampaignSummary = (campaignId, scopeType = 'campaign', scopeId = null) => {
  const events = db.prepare('SELECT type, payload_json, created_at FROM events WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 20').all(campaignId);
  const confirmedFacts = events.reverse().map((event) => `${event.type} (${event.created_at})`);
  return saveSummary(campaignId, scopeType, scopeId, { sceneSummary: confirmedFacts.slice(-5).join('; ') || 'Nessun evento registrato.', confirmedFacts, assumptions: [], openQuestions: [], activeThreats: [], activeGoals: [], unresolvedContradictions: [], recentChanges: confirmedFacts.slice(-5) });
};

module.exports = { archiveMemory, buildCampaignSummary, createMemory, getMemory, getSummary, listMemories, relevantMemoryContext, saveSummary, updateMemory };
