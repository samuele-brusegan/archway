const { db } = require('./db');
const { callOllamaJson, characterModel } = require('./ollama');
const { validateContract } = require('./contracts');
const { narrativeContext } = require('./state');

const parseState = (value) => {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};

const decideCharacter = async ({ campaignId, characterId }) => {
  const context = narrativeContext(campaignId, characterId);
  const state = parseState(db.prepare('SELECT state_json FROM characters WHERE id = ?').get(characterId)?.state_json);
  const system = `You are an NPC decision engine for Archway. Return exactly one JSON intent for the character. Choose only a feasible action from the allowed list. Use only IDs in the supplied context. Do not narrate. Do not modify state. If no useful action is possible, choose observe with confidence 0.5. Allowed actions: observe, move, traverse, take_item, drop_item, equip_item, advance_time, discover_connection, make_noise.`;
  const user = JSON.stringify({
    character: context.actor,
    psychology: state.psychology || state.traits || {},
    goals: state.goals || [],
    fears: state.fears || [],
    context: context.perception,
    campaign: context.campaign,
  });
  const raw = await callOllamaJson({ system, user, model: characterModel });
  const normalized = { ...raw, actorId: raw.actorId || characterId, action: raw.action || 'observe' };
  if (raw.actorId && raw.actorId !== characterId) throw new Error('NPC model returned a different actorId');
  return validateContract('intent', normalized);
};

const getCharacter = (campaignId, characterId) => db.prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?').get(characterId, campaignId);

const updatePsychology = ({ campaignId, characterId, changes, reasonEventId }) => {
  const character = getCharacter(campaignId, characterId);
  if (!character) throw new Error('Character not found');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw new Error('Psychology changes are required');
  const state = parseState(character.state_json);
  const psychology = { ...(state.psychology || {}), ...changes };
  const updatedAt = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE characters SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...state, psychology }), updatedAt, characterId);
    const eventId = reasonEventId || require('node:crypto').randomUUID();
    if (reasonEventId && !db.prepare('SELECT id FROM events WHERE id = ? AND campaign_id = ?').get(reasonEventId, campaignId)) throw new Error('Reason event not found');
    if (!reasonEventId) db.prepare(`INSERT INTO events (id, campaign_id, type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(eventId, campaignId, 'character.psychology_updated', characterId, JSON.stringify({ changes }), updatedAt);
    db.exec('COMMIT');
    return { characterId, psychology, reasonEventId: eventId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const reactToExecution = ({ campaignId, actorId, execution }) => {
  const actor = getCharacter(campaignId, actorId);
  if (!actor?.location_id) return [];
  const nearby = db.prepare(`SELECT * FROM characters WHERE campaign_id = ? AND location_id = ? AND id != ? AND role != 'protagonist' ORDER BY created_at LIMIT 3`)
    .all(campaignId, actor.location_id, actorId);
  const motivatingEvent = execution.events?.[0];
  if (!motivatingEvent) return [];
  return nearby.map((npc) => {
    const state = parseState(npc.state_json);
    const psychology = { ...(state.psychology || {}) };
    if (execution.action === 'make_noise') psychology.stress = Math.min(100, Number(psychology.stress || 0) + 5);
    if (execution.action === 'talk') psychology.curiosity = Math.min(100, Number(psychology.curiosity || 0) + 2);
    db.prepare('UPDATE characters SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...state, psychology }), new Date().toISOString(), npc.id);
    const eventId = require('node:crypto').randomUUID();
    db.prepare(`INSERT INTO events (id, campaign_id, type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(eventId, campaignId, 'character.reacted', npc.id, JSON.stringify({ reasonEventId: motivatingEvent.id, action: execution.action, psychology }), new Date().toISOString());
    return { characterId: npc.id, reasonEventId: motivatingEvent.id, psychology };
  });
};

module.exports = { decideCharacter, getCharacter, reactToExecution, updatePsychology };
