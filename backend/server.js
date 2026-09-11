const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { db, databasePath, tableCounts } = require('./src/db');
const { StateError, executeCommand } = require('./src/state');

const port = Number(process.env.PORT || 3001);
const ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) req.destroy(new Error('Request body too large'));
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error('Invalid JSON'));
    }
  });
  req.on('error', reject);
});

const now = () => new Date().toISOString();

const createCampaign = (input) => {
  const id = randomUUID();
  const timestamp = now();
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'Nuova campagna';
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO campaigns (id, title, genre, tone, premise, current_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, title, input.genre || '', input.tone || '', input.premise || '', timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO events (id, campaign_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), id, 'campaign.created', JSON.stringify({ title }), timestamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'backend' });
  }

  if (req.method === 'GET' && req.url === '/api/system') {
    return sendJson(res, 200, {
      service: 'backend',
      ai: { provider: 'ollama', url: ollamaUrl },
      phase: 1,
      database: { path: databasePath, tables: tableCounts() },
    });
  }

  if (req.method === 'GET' && req.url === '/api/db/status') {
    return sendJson(res, 200, { database: databasePath, tables: tableCounts() });
  }

  if (req.method === 'POST' && req.url === '/api/campaigns') {
    try {
      const campaign = createCampaign(await readJsonBody(req));
      return sendJson(res, 201, campaign);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const campaignMatch = req.url.match(/^\/api\/campaigns\/([^/]+)$/);
  if (req.method === 'GET' && campaignMatch) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignMatch[1]);
    if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
    return sendJson(res, 200, {
      ...campaign,
      characters: db.prepare('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      places: db.prepare('SELECT * FROM places WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      events: db.prepare('SELECT * FROM events WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
    });
  }

  const collectionMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/(places|connections|characters|items)$/);
  if (req.method === 'POST' && collectionMatch) {
    const campaignId = collectionMatch[1];
    const collection = collectionMatch[2];
    try {
      db.prepare('SELECT id FROM campaigns WHERE id = ? AND archived_at IS NULL').get(campaignId) || (() => { throw new Error('Campaign not found'); })();
      const input = await readJsonBody(req);
      const id = randomUUID();
      const created = now();
      if (collection === 'places') {
        if (!input.name) throw new Error('name is required');
        if (input.parentId) db.prepare('SELECT id FROM places WHERE id = ? AND campaign_id = ?').get(input.parentId, campaignId) || (() => { throw new Error('Parent place not found'); })();
        db.prepare(`INSERT INTO places (id, campaign_id, parent_id, name, kind, description, state_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, input.parentId || null, input.name, input.kind || 'place', input.description || '', JSON.stringify(input.state || {}), created, created);
      } else if (collection === 'connections') {
        if (!input.fromPlaceId || !input.toPlaceId || !input.name) throw new Error('fromPlaceId, toPlaceId and name are required');
        db.prepare(`INSERT INTO place_connections (id, campaign_id, from_place_id, to_place_id, name, state_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, input.fromPlaceId, input.toPlaceId, input.name, JSON.stringify(input.state || {}), created, created);
      } else if (collection === 'characters') {
        if (!input.name) throw new Error('name is required');
        if (input.locationId) db.prepare('SELECT id FROM places WHERE id = ? AND campaign_id = ?').get(input.locationId, campaignId) || (() => { throw new Error('Location not found'); })();
        db.prepare(`INSERT INTO characters (id, campaign_id, name, role, physical_description, psychological_description, state_json, location_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, input.name, input.role || 'npc', input.physicalDescription || '', input.psychologicalDescription || '', JSON.stringify(input.state || {}), input.locationId || null, created, created);
      } else {
        if (!input.name) throw new Error('name is required');
        if (input.locationId) db.prepare('SELECT id FROM places WHERE id = ? AND campaign_id = ?').get(input.locationId, campaignId) || (() => { throw new Error('Location not found'); })();
        db.prepare(`INSERT INTO items (id, campaign_id, name, description, state_json, location_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, input.name, input.description || '', JSON.stringify(input.state || {}), input.locationId || null, created, created);
      }
      return sendJson(res, 201, { id, campaignId, collection });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const commandMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/commands$/);
  if (req.method === 'POST' && commandMatch) {
    try {
      return sendJson(res, 200, executeCommand(commandMatch[1], await readJsonBody(req)));
    } catch (error) {
      const status = error instanceof StateError && error.code.endsWith('_NOT_FOUND') ? 404 : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'COMMAND_FAILED' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Archway backend listening on ${port}`);
});
