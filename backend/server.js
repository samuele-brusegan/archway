const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { db, databasePath, tableCounts } = require('./src/db');
const { StateError, executeCommand, narrativeContext } = require('./src/state');
const { ContractError, validateContract } = require('./src/contracts');
const { simulate } = require('./src/ai-simulator');
const { interpretUserInput, interpreterModel, narrateTurn, narratorModel } = require('./src/ollama');

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
      phase: 6,
      interpreterModel,
      narratorModel,
      database: { path: databasePath, tables: tableCounts() },
    });
  }

  if (req.method === 'GET' && req.url === '/api/db/status') {
    return sendJson(res, 200, { database: databasePath, tables: tableCounts() });
  }

  if (req.method === 'POST' && req.url === '/api/contracts/validate') {
    try {
      const input = await readJsonBody(req);
      return sendJson(res, 200, { valid: true, type: input.type, value: validateContract(input.type, input.value) });
    } catch (error) {
      const status = error instanceof ContractError ? 422 : 400;
      return sendJson(res, status, { valid: false, error: error.message, code: error.code || 'CONTRACT_REQUEST_INVALID', path: error.path || '$' });
    }
  }

  if (req.method === 'POST' && req.url === '/api/ai/simulate') {
    try {
      const input = await readJsonBody(req);
      return sendJson(res, 200, { provider: 'simulator', task: input.task, value: simulate(input.task, input.input || {}) });
    } catch (error) {
      return sendJson(res, 422, { error: error.message, code: error.code || 'SIMULATION_FAILED', path: error.path || '$' });
    }
  }

  const perceptionMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/perception\/([^/]+)$/);
  if (req.method === 'GET' && perceptionMatch) {
    try {
      const { perception } = require('./src/state');
      return sendJson(res, 200, perception(perceptionMatch[1], perceptionMatch[2]));
    } catch (error) {
      return sendJson(res, 404, { error: error.message, code: error.code || 'PERCEPTION_FAILED' });
    }
  }

  const knowledgeMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/knowledge$/);
  if (req.method === 'GET' && knowledgeMatch) {
    try {
      const { getKnowledge } = require('./src/state');
      return sendJson(res, 200, getKnowledge(knowledgeMatch[1], knowledgeMatch[2]));
    } catch (error) {
      return sendJson(res, 404, { error: error.message, code: error.code || 'KNOWLEDGE_FAILED' });
    }
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

  const inputMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/input$/);
  if (req.method === 'POST' && inputMatch) {
    try {
      const input = await readJsonBody(req);
      if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new Error('actorId is required');
      if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('text is required');
      const { perception } = require('./src/state');
      const available = perception(inputMatch[1], input.actorId);
      const rawIntent = await interpretUserInput({ actorId: input.actorId, text: input.text, perception: available });
      const intent = validateContract('intent', rawIntent);
      if (intent.confidence < 0.45) return sendJson(res, 422, { error: 'Input not understood with sufficient confidence', code: 'LOW_CONFIDENCE', intent });
      const command = { ...intent };
      delete command.type;
      delete command.confidence;
      const execution = executeCommand(inputMatch[1], command);
      let narrative;
      let narrativeError = null;
      try {
        const context = narrativeContext(inputMatch[1], input.actorId);
        narrative = await narrateTurn({ inputText: input.text, actorName: context.actor.name, context, execution });
      } catch (error) {
        narrativeError = error.message;
        narrative = execution.events.length
          ? "L'azione viene eseguita e il mondo registra la conseguenza."
          : 'Non accade nulla di nuovo.';
      }
      return sendJson(res, 200, { intent, execution, narrative, narrativeFallback: Boolean(narrativeError), ...(narrativeError ? { narrativeError } : {}) });
    } catch (error) {
      const status = error instanceof ContractError ? 422 : error instanceof StateError && error.code.endsWith('_NOT_FOUND') ? 404 : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'INPUT_FAILED', path: error.path || '$' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Archway backend listening on ${port}`);
});
