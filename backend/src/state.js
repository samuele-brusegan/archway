const { randomUUID } = require('node:crypto');
const { db } = require('./db');
const { validateContract } = require('./contracts');

class StateError extends Error {
  constructor(message, code = 'STATE_INVALID') {
    super(message);
    this.code = code;
  }
}

const timestamp = () => new Date().toISOString();
const parseState = (value) => {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
};

const campaign = (campaignId) => {
  const result = db.prepare('SELECT * FROM campaigns WHERE id = ? AND archived_at IS NULL').get(campaignId);
  if (!result) throw new StateError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
  return result;
};

const character = (campaignId, characterId) => {
  const result = db.prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?').get(characterId, campaignId);
  if (!result) throw new StateError('Character not found', 'CHARACTER_NOT_FOUND');
  return result;
};

const place = (campaignId, placeId) => {
  const result = db.prepare('SELECT * FROM places WHERE id = ? AND campaign_id = ?').get(placeId, campaignId);
  if (!result) throw new StateError('Place not found', 'PLACE_NOT_FOUND');
  return result;
};

const recordEvent = (campaignId, type, actorId, payload) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO events (id, campaign_id, type, actor_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, campaignId, type, actorId || null, JSON.stringify(payload || {}), timestamp());
  return { id, type, actorId: actorId || null, payload };
};

const updateCampaignTime = (campaignId, value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new StateError('Invalid campaign time', 'INVALID_TIME');
  const next = parsed.toISOString();
  db.prepare('UPDATE campaigns SET current_time = ?, updated_at = ? WHERE id = ?').run(next, timestamp(), campaignId);
  return next;
};

const visibleState = (campaignId, actor) => {
  const currentPlace = actor.location_id ? place(campaignId, actor.location_id) : null;
  const actorState = parseState(actor.state_json);
  const placeState = parseState(currentPlace?.state_json);
  const canSee = placeState.lighting !== 'dark' || actorState.hasLight === true || actorState.nightVision === true;
  const characters = actor.location_id && canSee
    ? db.prepare(`SELECT id, name, role, physical_description, psychological_description, location_id
      FROM characters WHERE campaign_id = ? AND location_id = ? AND json_extract(state_json, '$.hidden') IS NOT 1`).all(campaignId, actor.location_id)
    : [];
  const items = actor.location_id && canSee
    ? db.prepare(`SELECT id, name, description, state_json, location_id, owner_character_id
      FROM items WHERE campaign_id = ? AND location_id = ? AND owner_character_id IS NULL
      AND json_extract(state_json, '$.hidden') IS NOT 1`).all(campaignId, actor.location_id)
    : [];
  const connections = actor.location_id
    ? db.prepare(`SELECT * FROM place_connections WHERE campaign_id = ? AND from_place_id = ?`).all(campaignId, actor.location_id)
      .filter((connection) => {
        const state = parseState(connection.state_json);
        if (!state.hidden) return true;
        return Boolean(db.prepare(`SELECT 1 FROM knowledge WHERE character_id = ? AND subject_type = 'connection' AND subject_id = ? AND status = 'active'`).get(actor.id, connection.id));
      })
      .map((connection) => ({ ...connection, state_json: undefined }))
    : [];
  return { place: currentPlace, canSee, characters, items, connections };
};

const getKnowledge = (campaignId, characterId) => {
  character(campaignId, characterId);
  return db.prepare(`SELECT * FROM knowledge WHERE campaign_id = ? AND character_id = ? AND status = 'active'
    ORDER BY updated_at DESC`).all(campaignId, characterId);
};

const addKnowledge = ({ campaignId, characterId, subjectType, subjectId, knowledgeType, content, sourceEventId, certainty = 1 }) => {
  const id = randomUUID();
  const current = timestamp();
  db.prepare(`INSERT INTO knowledge (id, campaign_id, character_id, subject_type, subject_id, knowledge_type, content, source_event_id, certainty, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_id, subject_type, subject_id, knowledge_type) DO UPDATE SET
      content = excluded.content, source_event_id = excluded.source_event_id,
      certainty = excluded.certainty, updated_at = excluded.updated_at, status = 'active'`).run(
      id, campaignId, characterId, subjectType, subjectId || null, knowledgeType || 'fact', content, sourceEventId || null, certainty, current, current);
};

const perception = (campaignId, characterId) => {
  const actor = character(campaignId, characterId);
  return { characterId, ...visibleState(campaignId, actor), knowledge: getKnowledge(campaignId, characterId) };
};

const executeCommand = (campaignId, input) => {
  try {
    input = validateContract('command', input);
  } catch (error) {
    throw new StateError(`${error.message} at ${error.path}`, error.code || 'INVALID_COMMAND');
  }
  const actorId = input.actorId;
  const action = input.action;
  if (!actorId || !action) throw new StateError('actorId and action are required', 'INVALID_COMMAND');

  const currentCampaign = campaign(campaignId);
  const actor = character(campaignId, actorId);
  const events = [];
  let result;

  db.exec('BEGIN');
  try {
    if (action === 'observe') {
      result = visibleState(campaignId, actor);
    } else if (action === 'move') {
      const target = place(campaignId, input.targetPlaceId);
      const connection = actor.location_id && db.prepare(`SELECT * FROM place_connections
        WHERE campaign_id = ? AND from_place_id = ? AND to_place_id = ?`).get(campaignId, actor.location_id, target.id);
      const connectionState = connection ? parseState(connection.state_json) : null;
      const discovered = connection && db.prepare(`SELECT 1 FROM knowledge
        WHERE character_id = ? AND subject_type = 'connection' AND subject_id = ? AND status = 'active'`).get(actor.id, connection.id);
      if (actor.location_id && (!connection || connectionState.blocked === true || connectionState.locked === true || (connectionState.hidden === true && !discovered))) {
        throw new StateError('Target place is not directly reachable', 'PLACE_NOT_REACHABLE');
      }
      db.prepare('UPDATE characters SET location_id = ?, updated_at = ? WHERE id = ?').run(target.id, timestamp(), actor.id);
      events.push(recordEvent(campaignId, 'character.moved', actor.id, { fromPlaceId: actor.location_id, toPlaceId: target.id }));
      result = { characterId: actor.id, locationId: target.id };
    } else if (action === 'traverse') {
      const connection = db.prepare(`SELECT * FROM place_connections
        WHERE id = ? AND campaign_id = ?`).get(input.connectionId, campaignId);
      if (!connection) throw new StateError('Connection not found', 'CONNECTION_NOT_FOUND');
      if (actor.location_id !== connection.from_place_id) throw new StateError('Character is not at the connection origin', 'WRONG_ORIGIN');
      if (parseState(connection.state_json).blocked === true || parseState(connection.state_json).locked === true) {
        throw new StateError('Connection is not traversable', 'CONNECTION_BLOCKED');
      }
      db.prepare('UPDATE characters SET location_id = ?, updated_at = ? WHERE id = ?').run(connection.to_place_id, timestamp(), actor.id);
      events.push(recordEvent(campaignId, 'character.traversed', actor.id, { connectionId: connection.id, toPlaceId: connection.to_place_id }));
      result = { characterId: actor.id, locationId: connection.to_place_id };
    } else if (action === 'take_item') {
      const item = db.prepare(`SELECT * FROM items WHERE id = ? AND campaign_id = ?`).get(input.itemId, campaignId);
      if (!item) throw new StateError('Item not found', 'ITEM_NOT_FOUND');
      if (item.owner_character_id || item.location_id !== actor.location_id) throw new StateError('Item is not available here', 'ITEM_NOT_AVAILABLE');
      db.prepare('UPDATE items SET location_id = NULL, owner_character_id = ?, updated_at = ? WHERE id = ?').run(actor.id, timestamp(), item.id);
      events.push(recordEvent(campaignId, 'item.taken', actor.id, { itemId: item.id }));
      result = { itemId: item.id, ownerCharacterId: actor.id };
    } else if (action === 'drop_item') {
      const item = db.prepare(`SELECT * FROM items WHERE id = ? AND campaign_id = ? AND owner_character_id = ?`).get(input.itemId, campaignId, actor.id);
      if (!item) throw new StateError('Character does not own this item', 'ITEM_NOT_OWNED');
      if (!actor.location_id) throw new StateError('Character has no location', 'NO_LOCATION');
      db.prepare('UPDATE items SET location_id = ?, owner_character_id = NULL, updated_at = ? WHERE id = ?').run(actor.location_id, timestamp(), item.id);
      events.push(recordEvent(campaignId, 'item.dropped', actor.id, { itemId: item.id, locationId: actor.location_id }));
      result = { itemId: item.id, locationId: actor.location_id };
    } else if (action === 'equip_item') {
      const item = db.prepare(`SELECT * FROM items WHERE id = ? AND campaign_id = ? AND owner_character_id = ?`).get(input.itemId, campaignId, actor.id);
      if (!item) throw new StateError('Character does not own this item', 'ITEM_NOT_OWNED');
      const state = parseState(actor.state_json);
      const equipment = Array.isArray(state.equipment) ? state.equipment : [];
      if (!equipment.includes(item.id)) equipment.push(item.id);
      db.prepare('UPDATE characters SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...state, equipment }), timestamp(), actor.id);
      events.push(recordEvent(campaignId, 'item.equipped', actor.id, { itemId: item.id }));
      result = { itemId: item.id, equipped: true };
    } else if (action === 'advance_time') {
      const seconds = Number(input.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400 * 30) throw new StateError('seconds must be between 1 and 2592000', 'INVALID_DURATION');
      const next = new Date(new Date(currentCampaign.current_time).getTime() + seconds * 1000).toISOString();
      updateCampaignTime(campaignId, next);
      events.push(recordEvent(campaignId, 'time.advanced', actor.id, { seconds, from: currentCampaign.current_time, to: next }));
      result = { currentTime: next };
    } else if (action === 'discover_connection') {
      const connection = db.prepare('SELECT * FROM place_connections WHERE id = ? AND campaign_id = ?').get(input.connectionId, campaignId);
      if (!connection) throw new StateError('Connection not found', 'CONNECTION_NOT_FOUND');
      if (actor.location_id !== connection.from_place_id) throw new StateError('Connection is not at the current place', 'WRONG_LOCATION');
      const connectionState = parseState(connection.state_json);
      if (!connectionState.hidden) throw new StateError('Connection is already visible', 'ALREADY_VISIBLE');
      const event = recordEvent(campaignId, 'connection.discovered', actor.id, { connectionId: connection.id });
      addKnowledge({ campaignId, characterId: actor.id, subjectType: 'connection', subjectId: connection.id, knowledgeType: 'discovery', content: `Discovered connection: ${connection.name}`, sourceEventId: event.id });
      events.push(event);
      result = { connectionId: connection.id, discovered: true };
    } else if (action === 'make_noise') {
      const intensity = Number(input.intensity);
      if (!Number.isFinite(intensity) || intensity < 1 || intensity > 100) throw new StateError('intensity must be between 1 and 100', 'INVALID_INTENSITY');
      const event = recordEvent(campaignId, 'noise.created', actor.id, { placeId: actor.location_id, intensity, description: input.description || 'Un rumore' });
      const listeners = db.prepare('SELECT id, location_id FROM characters WHERE campaign_id = ? AND id != ?').all(campaignId, actor.id);
      for (const listener of listeners) {
        if (!listener.location_id) continue;
        const samePlace = listener.location_id === actor.location_id;
        const adjacent = db.prepare(`SELECT 1 FROM place_connections WHERE campaign_id = ?
          AND ((from_place_id = ? AND to_place_id = ?) OR (from_place_id = ? AND to_place_id = ?))
          AND json_extract(state_json, '$.soundproof') IS NOT 1`).get(campaignId, actor.location_id, listener.location_id, listener.location_id, actor.location_id);
        if (samePlace || (adjacent && intensity >= 40)) {
          addKnowledge({ campaignId, characterId: listener.id, subjectType: 'event', subjectId: event.id, knowledgeType: 'perception', content: `Heard a noise near place ${actor.location_id}`, sourceEventId: event.id, certainty: samePlace ? 1 : 0.7 });
        }
      }
      events.push(event);
      result = { eventId: event.id, intensity };
    } else {
      throw new StateError(`Unsupported action: ${action}`, 'UNSUPPORTED_ACTION');
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { action, actorId, result, events };
};

module.exports = { StateError, executeCommand, getKnowledge, perception };
