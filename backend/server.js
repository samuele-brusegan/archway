const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { db, databasePath, tableCounts } = require('./src/db');
const { StateError, executeCommand, narrativeContext } = require('./src/state');
const { ContractError, validateContract } = require('./src/contracts');
const { simulate } = require('./src/ai-simulator');
const { interpretUserInput, interpreterModel, narrateTurn, narratorModel } = require('./src/ollama');
const { decideCharacter, getCharacter, updatePsychology } = require('./src/npc');
const { archiveMemory, buildCampaignSummary, createMemory, getMemory, getSummary, listMemories, relevantMemoryContext, saveSummary, updateMemory } = require('./src/memory');
const { TurnError, branchTurn, getTrace, listTraces, removeTurn, resumeTurn, runUserTurn } = require('./src/turn-director');

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
      phase: 9,
      interpreterModel,
      narratorModel,
      characterModel: require('./src/ollama').characterModel,
      database: { path: databasePath, tables: tableCounts() },
    });
  }

  if (req.method === 'GET' && req.url === '/api/db/status') {
    return sendJson(res, 200, { database: databasePath, tables: tableCounts() });
  }

  const traceMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/turns\/([^/]+)$/);
  const branchMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/turns\/([^/]+)\/branch$/);
  if (req.method === 'POST' && branchMatch) {
    try {
      const input = await readJsonBody(req);
      const trace = getTrace(branchMatch[2]);
      if (!trace || trace.campaign_id !== branchMatch[1]) return sendJson(res, 404, { error: 'Turn trace not found', code: 'TRACE_NOT_FOUND' });
      return sendJson(res, 200, await branchTurn({ traceId: branchMatch[2], text: input.text }));
    } catch (error) {
      const status = error instanceof TurnError ? error.status : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'TURN_BRANCH_FAILED', ...(error.traceId ? { traceId: error.traceId } : {}) });
    }
  }

  if (req.method === 'DELETE' && traceMatch) {
    try {
      const trace = getTrace(traceMatch[2]);
      if (!trace || trace.campaign_id !== traceMatch[1]) return sendJson(res, 404, { error: 'Turn trace not found', code: 'TRACE_NOT_FOUND' });
      return sendJson(res, 200, await removeTurn(trace.id));
    } catch (error) {
      const status = error instanceof TurnError ? error.status : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'TURN_DELETE_FAILED' });
    }
  }

  if (req.method === 'PATCH' && traceMatch) {
    try {
      const input = await readJsonBody(req);
      const trace = getTrace(traceMatch[2]);
      if (!trace || trace.campaign_id !== traceMatch[1]) return sendJson(res, 404, { error: 'Turn trace not found', code: 'TRACE_NOT_FOUND' });
      return sendJson(res, 200, await branchTurn({ traceId: traceMatch[2], text: input.text }));
    } catch (error) {
      const status = error instanceof TurnError ? error.status : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'TURN_EDIT_FAILED', ...(error.traceId ? { traceId: error.traceId } : {}) });
    }
  }

  if (req.method === 'POST' && traceMatch) {
    try {
      const trace = getTrace(traceMatch[2]);
      if (!trace || trace.campaign_id !== traceMatch[1]) return sendJson(res, 404, { error: 'Turn trace not found', code: 'TRACE_NOT_FOUND' });
      return sendJson(res, 200, await resumeTurn(traceMatch[2]));
    } catch (error) {
      const status = error instanceof TurnError ? error.status : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'TURN_RESUME_FAILED', ...(error.traceId ? { traceId: error.traceId } : {}) });
    }
  }

  if (req.method === 'GET' && traceMatch) {
    const trace = getTrace(traceMatch[2]);
    if (!trace || trace.campaign_id !== traceMatch[1]) return sendJson(res, 404, { error: 'Turn trace not found', code: 'TRACE_NOT_FOUND' });
    return sendJson(res, 200, trace);
  }

  const tracesMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/turns$/);
  if (req.method === 'GET' && tracesMatch) {
    return sendJson(res, 200, listTraces(tracesMatch[1]));
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

  const memoryCollectionMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/memories$/);
  if (memoryCollectionMatch && ['GET', 'POST'].includes(req.method)) {
    try {
      const [campaignId, characterId] = memoryCollectionMatch.slice(1);
      if (req.method === 'GET') return sendJson(res, 200, listMemories(campaignId, characterId));
      return sendJson(res, 201, createMemory(campaignId, characterId, await readJsonBody(req)));
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'MEMORY_CREATE_FAILED' });
    }
  }

  const memoryMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/memories\/([^/]+)$/);
  if (memoryMatch && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
    try {
      const [campaignId, characterId, memoryId] = memoryMatch.slice(1);
      if (req.method === 'GET') return sendJson(res, 200, getMemory(campaignId, characterId, memoryId));
      if (req.method === 'DELETE') return sendJson(res, 200, archiveMemory(campaignId, characterId, memoryId));
      return sendJson(res, 200, updateMemory(campaignId, characterId, memoryId, await readJsonBody(req)));
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'MEMORY_UPDATE_FAILED' });
    }
  }

  const contextMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/context$/);
  if (req.method === 'POST' && contextMatch) {
    try {
      const input = await readJsonBody(req);
      return sendJson(res, 200, {
        memory: relevantMemoryContext(contextMatch[1], contextMatch[2], input),
        summary: getSummary(contextMatch[1], input.scopeType || 'campaign', input.scopeId || null),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'CONTEXT_BUILD_FAILED' });
    }
  }

  const summaryMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/summaries$/);
  if (req.method === 'POST' && summaryMatch) {
    try {
      const input = await readJsonBody(req);
      if (input.auto === true) return sendJson(res, 200, buildCampaignSummary(summaryMatch[1], input.scopeType || 'campaign', input.scopeId || null));
      return sendJson(res, 200, saveSummary(summaryMatch[1], input.scopeType || 'campaign', input.scopeId || null, input.summary, input.tokenBudget || 1000));
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'SUMMARY_SAVE_FAILED' });
    }
  }

  const summaryGetMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/summaries\/([^/]+)$/);
  if (req.method === 'GET' && summaryGetMatch) {
    return sendJson(res, 200, getSummary(summaryGetMatch[1], summaryGetMatch[2]) || { summary: null });
  }

  if (req.method === 'POST' && req.url === '/api/campaigns') {
    try {
      const campaign = createCampaign(await readJsonBody(req));
      return sendJson(res, 201, campaign);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url === '/api/campaigns') {
    return sendJson(res, 200, db.prepare('SELECT * FROM campaigns WHERE archived_at IS NULL ORDER BY updated_at DESC').all());
  }

  const campaignMatch = req.url.match(/^\/api\/campaigns\/([^/]+)$/);
  if (req.method === 'GET' && campaignMatch) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignMatch[1]);
    if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
    return sendJson(res, 200, {
      ...campaign,
      characters: db.prepare('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      places: db.prepare('SELECT * FROM places WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      connections: db.prepare('SELECT * FROM place_connections WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      items: db.prepare('SELECT * FROM items WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
      events: db.prepare('SELECT * FROM events WHERE campaign_id = ? ORDER BY created_at').all(campaign.id),
    });
  }

  const characterPatchMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)$/);
  if (req.method === 'PATCH' && characterPatchMatch) {
    try {
      const input = await readJsonBody(req);
      const character = db.prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?').get(characterPatchMatch[2], characterPatchMatch[1]);
      if (!character) return sendJson(res, 404, { error: 'Character not found', code: 'CHARACTER_NOT_FOUND' });
      const allowed = ['name', 'role', 'physicalDescription', 'psychologicalDescription', 'locationId', 'state'];
      const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
      if (unknown.length) return sendJson(res, 422, { error: `Unsupported character fields: ${unknown.join(', ')}`, code: 'CHARACTER_PATCH_INVALID' });
      if (input.locationId && !db.prepare('SELECT id FROM places WHERE id = ? AND campaign_id = ?').get(input.locationId, characterPatchMatch[1])) return sendJson(res, 422, { error: 'Location not found', code: 'LOCATION_NOT_FOUND' });
      const state = input.state === undefined ? character.state_json : JSON.stringify(input.state);
      db.prepare(`UPDATE characters SET name = ?, role = ?, physical_description = ?, psychological_description = ?, location_id = ?, state_json = ?, updated_at = ?
        WHERE id = ? AND campaign_id = ?`).run(input.name ?? character.name, input.role ?? character.role, input.physicalDescription ?? character.physical_description, input.psychologicalDescription ?? character.psychological_description, input.locationId ?? character.location_id, state, now(), character.id, characterPatchMatch[1]);
      return sendJson(res, 200, db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id));
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'CHARACTER_PATCH_FAILED' });
    }
  }

  const collectionMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/(places|connections|characters|items|relationships)$/);
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
      } else if (collection === 'items') {
        if (!input.name) throw new Error('name is required');
        if (input.locationId) db.prepare('SELECT id FROM places WHERE id = ? AND campaign_id = ?').get(input.locationId, campaignId) || (() => { throw new Error('Location not found'); })();
        db.prepare(`INSERT INTO items (id, campaign_id, name, description, state_json, location_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, input.name, input.description || '', JSON.stringify(input.state || {}), input.locationId || null, created, created);
      } else {
        if (!input.fromCharacterId || !input.toCharacterId) throw new Error('fromCharacterId and toCharacterId are required');
        if (input.fromCharacterId === input.toCharacterId) throw new Error('Relationship must connect two different characters');
        const characterCount = db.prepare(`SELECT COUNT(*) AS count FROM characters WHERE campaign_id = ? AND id IN (?, ?)`)
          .get(campaignId, input.fromCharacterId, input.toCharacterId).count;
        if (characterCount !== 2) throw new Error('Both relationship characters must exist in the campaign');
        db.prepare(`INSERT INTO relationships (id, campaign_id, from_character_id, to_character_id, state_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(from_character_id, to_character_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
          .run(id, campaignId, input.fromCharacterId, input.toCharacterId, JSON.stringify(input.state || {}), created, created);
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
      return sendJson(res, 200, await runUserTurn({ campaignId: inputMatch[1], actorId: input.actorId, text: input.text, narratorMessage: input.narratorMessage || '' }));
    } catch (error) {
      const status = error instanceof TurnError ? error.status : error instanceof ContractError ? 422 : error instanceof StateError && error.code.endsWith('_NOT_FOUND') ? 404 : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'INPUT_FAILED', ...(error.traceId ? { traceId: error.traceId } : {}), path: error.path || '$' });
    }
  }

  const decisionMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/decide$/);
  if (req.method === 'POST' && decisionMatch) {
    try {
      const character = getCharacter(decisionMatch[1], decisionMatch[2]);
      if (!character) return sendJson(res, 404, { error: 'Character not found', code: 'CHARACTER_NOT_FOUND' });
      if (character.role === 'protagonist') return sendJson(res, 409, { error: 'The protagonist is controlled by the user', code: 'PROTAGONIST_AUTONOMY_DENIED' });
      const intent = await decideCharacter({ campaignId: decisionMatch[1], characterId: decisionMatch[2] });
      const command = { ...intent };
      delete command.type;
      delete command.confidence;
      const execution = executeCommand(decisionMatch[1], command);
      return sendJson(res, 200, { intent, execution });
    } catch (error) {
      const status = error instanceof ContractError ? 422 : error instanceof StateError && error.code.endsWith('_NOT_FOUND') ? 404 : 409;
      return sendJson(res, status, { error: error.message, code: error.code || 'CHARACTER_DECISION_FAILED', path: error.path || '$' });
    }
  }

  const psychologyMatch = req.url.match(/^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/psychology$/);
  if (req.method === 'PATCH' && psychologyMatch) {
    try {
      const input = await readJsonBody(req);
      return sendJson(res, 200, updatePsychology({ campaignId: psychologyMatch[1], characterId: psychologyMatch[2], changes: input.changes, reasonEventId: input.reasonEventId }));
    } catch (error) {
      return sendJson(res, 400, { error: error.message, code: 'PSYCHOLOGY_UPDATE_FAILED' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Archway backend listening on ${port}`);
});
