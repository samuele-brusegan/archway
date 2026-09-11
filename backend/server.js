const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { db, databasePath, tableCounts } = require('./src/db');

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

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Archway backend listening on ${port}`);
});
