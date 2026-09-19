const { randomUUID } = require('node:crypto');
const { db } = require('./db');

const now = () => new Date().toISOString();
const campaignTables = ['characters', 'places', 'place_connections', 'items', 'memories', 'relationships', 'knowledge', 'context_summaries', 'factions', 'missions', 'scheduled_events', 'events'];

const requireCampaign = (campaignId) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND archived_at IS NULL').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  return campaign;
};

const recordEvent = (campaignId, type, payload = {}, actorId = null, visibility = 'public') => {
  const id = randomUUID();
  db.prepare(`INSERT INTO events (id, campaign_id, type, actor_id, payload_json, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, type, actorId, JSON.stringify(payload), visibility, now());
  return id;
};

const exportCampaign = (campaignId) => {
  const campaign = requireCampaign(campaignId);
  const data = { format: 'archway-campaign', version: 1, exportedAt: now(), campaign };
  for (const table of campaignTables) data[table] = db.prepare(`SELECT * FROM ${table} WHERE campaign_id = ?`).all(campaignId);
  data.faction_members = db.prepare(`SELECT fm.* FROM faction_members fm JOIN factions f ON f.id = fm.faction_id WHERE f.campaign_id = ?`).all(campaignId);
  return data;
};

const insertRows = (table, rows) => {
  for (const row of rows || []) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map((column) => row[column]));
  }
};

const createVersion = (campaignId, label = 'Salvataggio manuale') => {
  const id = randomUUID();
  const createdAt = now();
  db.prepare('INSERT INTO campaign_versions (id, campaign_id, label, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, campaignId, String(label).trim() || 'Salvataggio manuale', JSON.stringify(exportCampaign(campaignId)), createdAt);
  recordEvent(campaignId, 'campaign.version_created', { versionId: id, label });
  return db.prepare('SELECT id, campaign_id, label, created_at FROM campaign_versions WHERE id = ?').get(id);
};

const listVersions = (campaignId) => db.prepare('SELECT id, campaign_id, label, created_at FROM campaign_versions WHERE campaign_id = ? ORDER BY created_at DESC').all(campaignId);

const restoreSnapshot = (campaignId, snapshot) => {
  if (!snapshot || snapshot.format !== 'archway-campaign' || !snapshot.campaign) throw new Error('Invalid Archway campaign snapshot');
  const deleteOrder = ['faction_members', 'knowledge', 'memory_versions', 'memories', 'relationships', 'items', 'characters', 'place_connections', 'places', 'context_summaries', 'missions', 'scheduled_events', 'factions', 'events'];
  db.exec('BEGIN');
  try {
    for (const table of deleteOrder) {
      if (table === 'faction_members') db.prepare('DELETE FROM faction_members WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)').run(campaignId);
      else if (table === 'memory_versions') db.prepare('DELETE FROM memory_versions WHERE campaign_id = ?').run(campaignId);
      else db.prepare(`DELETE FROM ${table} WHERE campaign_id = ?`).run(campaignId);
    }
    const source = snapshot.campaign;
    db.prepare(`UPDATE campaigns SET title = ?, genre = ?, tone = ?, premise = ?, current_time = ?, updated_at = ?, archived_at = ? WHERE id = ?`)
      .run(source.title, source.genre, source.tone, source.premise, source.current_time, now(), source.archived_at || null, campaignId);
    for (const table of ['places', 'characters', 'place_connections', 'items', 'events', 'memories', 'relationships', 'knowledge', 'context_summaries', 'factions', 'faction_members', 'missions', 'scheduled_events']) insertRows(table, snapshot[table]);
    recordEvent(campaignId, 'campaign.restored', { restoredAt: now() });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return exportCampaign(campaignId);
};

const restoreVersion = (campaignId, versionId) => {
  const version = db.prepare('SELECT * FROM campaign_versions WHERE id = ? AND campaign_id = ?').get(versionId, campaignId);
  if (!version) throw new Error('Campaign version not found');
  return restoreSnapshot(campaignId, JSON.parse(version.snapshot_json));
};

const createDemoCampaign = () => {
  const campaignId = randomUUID();
  const createdAt = now();
  const ids = Object.fromEntries(['hero', 'marta', 'elio', 'nora', 'hall', 'library', 'cellar', 'courtyard', 'key', 'mission', 'faction'].map((name) => [name, randomUUID()]));
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO campaigns (id, title, genre, tone, premise, current_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(campaignId, 'La casa delle soglie', 'mistero', 'teso e investigativo', 'Una casa custodisce un passaggio che nessuno dovrebbe conoscere.', createdAt, createdAt, createdAt);
    const placeInsert = db.prepare(`INSERT INTO places (id, campaign_id, parent_id, name, kind, description, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    placeInsert.run(ids.hall, campaignId, null, 'Atrio', 'room', 'Un atrio silenzioso illuminato da una lampada a olio.', JSON.stringify({ lighting: 'dim' }), createdAt, createdAt);
    placeInsert.run(ids.library, campaignId, null, 'Biblioteca', 'room', 'Scaffali alti circondano un tavolo coperto di appunti.', '{}', createdAt, createdAt);
    placeInsert.run(ids.cellar, campaignId, null, 'Cantina', 'room', 'La cantina odora di pietra umida.', JSON.stringify({ lighting: 'dark' }), createdAt, createdAt);
    placeInsert.run(ids.courtyard, campaignId, null, 'Cortile', 'outdoor', 'Un cortile chiuso separa le due ali della casa.', '{}', createdAt, createdAt);
    const charInsert = db.prepare(`INSERT INTO characters (id, campaign_id, name, role, physical_description, psychological_description, state_json, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    charInsert.run(ids.hero, campaignId, 'Viandante', 'protagonist', 'Un viaggiatore coperto di polvere.', 'Attento e determinato.', JSON.stringify({ equipment: [], psychology: { curiosity: 60 } }), ids.hall, createdAt, createdAt);
    charInsert.run(ids.marta, campaignId, 'Marta', 'npc', '', 'Prudente, teme la cantina.', JSON.stringify({ goals: ['Proteggere il segreto'], psychology: { trust: 20, stress: 15 } }), ids.hall, createdAt, createdAt);
    charInsert.run(ids.elio, campaignId, 'Elio', 'npc', '', 'Curioso e impulsivo.', JSON.stringify({ goals: ['Aprire il passaggio'], psychology: { curiosity: 80 } }), ids.library, createdAt, createdAt);
    charInsert.run(ids.nora, campaignId, 'Nora', 'npc', '', 'Leale alla custodia.', JSON.stringify({ goals: ['Sorvegliare la casa'], psychology: { morale: 70 } }), ids.courtyard, createdAt, createdAt);
    const connectionInsert = db.prepare(`INSERT INTO place_connections (id, campaign_id, from_place_id, to_place_id, name, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    connectionInsert.run(randomUUID(), campaignId, ids.hall, ids.library, 'porta della biblioteca', '{}', createdAt, createdAt);
    connectionInsert.run(randomUUID(), campaignId, ids.library, ids.hall, 'porta dell’atrio', '{}', createdAt, createdAt);
    connectionInsert.run(randomUUID(), campaignId, ids.hall, ids.courtyard, 'porta chiusa', JSON.stringify({ locked: true }), createdAt, createdAt);
    connectionInsert.run(randomUUID(), campaignId, ids.library, ids.cellar, 'scala nascosta', JSON.stringify({ hidden: true }), createdAt, createdAt);
    db.prepare(`INSERT INTO items (id, campaign_id, name, description, state_json, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ids.key, campaignId, 'Chiave di ottone', 'Una chiave consumata con il simbolo della casa.', JSON.stringify({ usable: true }), ids.hall, createdAt, createdAt);
    db.prepare(`INSERT INTO relationships (id, campaign_id, from_character_id, to_character_id, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), campaignId, ids.marta, ids.hero, JSON.stringify({ trust: 20, suspicion: 35 }), createdAt, createdAt);
    db.prepare(`INSERT INTO missions (id, campaign_id, title, description, status, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', '{}', ?, ?)`)
      .run(ids.mission, campaignId, 'Trova il passaggio', 'Scopri cosa nasconde la biblioteca senza tradire la fiducia di Marta.', createdAt, createdAt);
    db.prepare(`INSERT INTO factions (id, campaign_id, name, description, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)`)
      .run(ids.faction, campaignId, 'Custodi della soglia', 'Proteggono i segreti della casa.', createdAt, createdAt);
    db.prepare(`INSERT INTO faction_members (faction_id, character_id, role, reputation) VALUES (?, ?, ?, ?)`)
      .run(ids.faction, ids.nora, 'custode', 50);
    db.prepare(`INSERT INTO memories (id, campaign_id, character_id, content, type, source, reliability, importance, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), campaignId, ids.marta, 'La scala della biblioteca conduce a un luogo pericoloso.', 'secret', 'event', 1, 90, 'active', createdAt, createdAt);
    db.prepare(`INSERT INTO scheduled_events (id, campaign_id, event_type, due_at, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`)
      .run(randomUUID(), campaignId, 'mission.warning_arrived', new Date(Date.parse(createdAt) + 3600000).toISOString(), JSON.stringify({ missionId: ids.mission, description: 'La campana dei custodi suona nel cortile.' }), createdAt);
    recordEvent(campaignId, 'campaign.demo_created', { title: 'La casa delle soglie' });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return requireCampaign(campaignId);
};

const importCampaign = (snapshot) => {
  if (!snapshot || snapshot.format !== 'archway-campaign' || !snapshot.campaign) throw new Error('Invalid Archway campaign export');
  const copy = structuredClone(snapshot);
  const oldId = copy.campaign.id;
  const campaignId = randomUUID();
  const timestamp = now();
  const idMap = new Map([[oldId, campaignId]]);
  for (const table of campaignTables) {
    for (const row of copy[table] || []) if (row.id) idMap.set(row.id, randomUUID());
  }
  const remap = (value) => value == null ? value : (idMap.get(value) || value);
  const remapJson = (value) => {
    try {
      const walk = (entry) => Array.isArray(entry) ? entry.map(walk) : entry && typeof entry === 'object'
        ? Object.fromEntries(Object.entries(entry).map(([key, nested]) => [key, walk(nested)]))
        : typeof entry === 'string' ? remap(entry) : entry;
      return JSON.stringify(walk(JSON.parse(value || '{}')));
    } catch { return value; }
  };
  copy.campaign = { ...copy.campaign, id: campaignId, title: `${copy.campaign.title} (importata)`, created_at: timestamp, updated_at: timestamp, archived_at: null };
  for (const table of campaignTables) copy[table] = (copy[table] || []).map((row) => ({ ...row, id: remap(row.id), campaign_id: campaignId }));
  copy.places = (copy.places || []).map((row) => ({ ...row, parent_id: remap(row.parent_id) }));
  copy.characters = (copy.characters || []).map((row) => ({ ...row, location_id: remap(row.location_id) }));
  copy.place_connections = (copy.place_connections || []).map((row) => ({ ...row, from_place_id: remap(row.from_place_id), to_place_id: remap(row.to_place_id) }));
  copy.items = (copy.items || []).map((row) => ({ ...row, location_id: remap(row.location_id), owner_character_id: remap(row.owner_character_id) }));
  copy.memories = (copy.memories || []).map((row) => ({ ...row, character_id: remap(row.character_id), location_id: remap(row.location_id) }));
  copy.relationships = (copy.relationships || []).map((row) => ({ ...row, from_character_id: remap(row.from_character_id), to_character_id: remap(row.to_character_id) }));
  copy.knowledge = (copy.knowledge || []).map((row) => ({ ...row, character_id: remap(row.character_id), subject_id: remap(row.subject_id), source_event_id: remap(row.source_event_id) }));
  copy.events = (copy.events || []).map((row) => ({ ...row, actor_id: remap(row.actor_id) }));
  copy.context_summaries = (copy.context_summaries || []).map((row) => ({ ...row, scope_id: remap(row.scope_id) }));
  copy.faction_members = (copy.faction_members || []).map((row) => ({ ...row, faction_id: remap(row.faction_id), character_id: remap(row.character_id) }));
  for (const table of ['characters', 'places', 'place_connections', 'items', 'relationships', 'factions', 'missions']) {
    copy[table] = (copy[table] || []).map((row) => ({ ...row, state_json: remapJson(row.state_json) }));
  }
  copy.events = (copy.events || []).map((row) => ({ ...row, payload_json: remapJson(row.payload_json) }));
  copy.scheduled_events = (copy.scheduled_events || []).map((row) => ({ ...row, payload_json: remapJson(row.payload_json) }));
  db.exec('BEGIN');
  try {
    const c = copy.campaign;
    db.prepare(`INSERT INTO campaigns (id, title, genre, tone, premise, current_time, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.id, c.title, c.genre, c.tone, c.premise, c.current_time, c.created_at, c.updated_at, null);
    for (const table of ['places', 'characters', 'place_connections', 'items', 'events', 'memories', 'relationships', 'knowledge', 'context_summaries', 'factions', 'faction_members', 'missions', 'scheduled_events']) insertRows(table, copy[table]);
    recordEvent(campaignId, 'campaign.imported', { sourceCampaignId: oldId });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return requireCampaign(campaignId);
};

module.exports = { createDemoCampaign, createVersion, exportCampaign, importCampaign, listVersions, recordEvent, requireCampaign, restoreVersion };
