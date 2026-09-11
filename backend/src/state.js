const { randomUUID } = require('node:crypto');
const { db } = require('./db');

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
  const characters = actor.location_id
    ? db.prepare('SELECT id, name, role, physical_description, psychological_description, location_id FROM characters WHERE campaign_id = ? AND location_id = ?').all(campaignId, actor.location_id)
    : [];
  const items = actor.location_id
    ? db.prepare('SELECT id, name, description, state_json, location_id, owner_character_id FROM items WHERE campaign_id = ? AND location_id = ? AND owner_character_id IS NULL').all(campaignId, actor.location_id)
    : [];
  return { place: currentPlace, characters, items };
};

const executeCommand = (campaignId, input) => {
  if (!input || typeof input !== 'object') throw new StateError('Command must be an object', 'INVALID_COMMAND');
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
      if (actor.location_id && !db.prepare(`SELECT 1 FROM place_connections
        WHERE campaign_id = ? AND from_place_id = ? AND to_place_id = ?
        AND json_extract(state_json, '$.blocked') IS NOT 1`).get(campaignId, actor.location_id, target.id)) {
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

module.exports = { StateError, executeCommand };
