const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const port = 32191;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'archway-test-'));
let child;

const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, { headers: { 'content-type': 'application/json' }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${payload.error}`);
  return payload;
};

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, OLLAMA_URL: 'http://127.0.0.1:9', OLLAMA_TIMEOUT_MS: '20', NARRATOR_STRICT_MODE: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await request('/health'); return; } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw lastError;
});

after(() => {
  child?.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
});

test('demo campaign exercises world, delayed events, memories and summaries', async () => {
  const created = await request('/api/demo', { method: 'POST', body: '{}' });
  const campaign = await request(`/api/campaigns/${created.id}`);
  assert.equal(campaign.characters.length, 4);
  assert.equal(campaign.places.length, 4);
  assert.equal(campaign.missions.length, 1);
  assert.equal(campaign.factions.length, 1);
  assert.equal(campaign.scheduledEvents.length, 1);

  const hero = campaign.characters.find((entry) => entry.role === 'protagonist');
  const marta = campaign.characters.find((entry) => entry.name === 'Marta');
  const key = campaign.items.find((entry) => entry.name === 'Chiave di ottone');
  await request(`/api/campaigns/${campaign.id}/commands`, { method: 'POST', body: JSON.stringify({ actorId: hero.id, action: 'take_item', itemId: key.id }) });
  const dialogue = await request(`/api/campaigns/${campaign.id}/commands`, { method: 'POST', body: JSON.stringify({ actorId: hero.id, action: 'talk', targetCharacterId: marta.id, message: 'Che cosa nasconde questa casa?' }) });
  assert.equal(dialogue.action, 'talk');
  const time = await request(`/api/campaigns/${campaign.id}/commands`, { method: 'POST', body: JSON.stringify({ actorId: hero.id, action: 'advance_time', seconds: 3601 }) });
  assert.equal(time.result.triggeredEvents.length, 1);

  const memories = await request(`/api/campaigns/${campaign.id}/characters/${marta.id}/memories`);
  await request(`/api/campaigns/${campaign.id}/characters/${marta.id}/memories/${memories[0].id}`, { method: 'PATCH', body: JSON.stringify({ importance: 95 }) });
  const versions = await request(`/api/campaigns/${campaign.id}/characters/${marta.id}/memories/${memories[0].id}/versions`);
  assert.equal(versions.length, 1);
  const summary = await request(`/api/campaigns/${campaign.id}/summaries`, { method: 'POST', body: JSON.stringify({ auto: true }) });
  assert.ok(summary.summary.activeGoals.includes('Trova il passaggio'));
});

test('campaign versions restore state and exports can be imported safely', async () => {
  const campaigns = await request('/api/campaigns');
  const campaign = await request(`/api/campaigns/${campaigns[0].id}`);
  const hero = campaign.characters.find((entry) => entry.role === 'protagonist');
  const version = await request(`/api/campaigns/${campaign.id}/versions`, { method: 'POST', body: JSON.stringify({ label: 'Checkpoint test' }) });
  await request(`/api/campaigns/${campaign.id}/characters/${hero.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Nome temporaneo' }) });
  await request(`/api/campaigns/${campaign.id}/versions/${version.id}/restore`, { method: 'POST', body: '{}' });
  const restored = await request(`/api/campaigns/${campaign.id}`);
  assert.notEqual(restored.characters.find((entry) => entry.id === hero.id).name, 'Nome temporaneo');

  const exported = await request(`/api/campaigns/${campaign.id}/export`);
  const imported = await request('/api/import', { method: 'POST', body: JSON.stringify(exported) });
  assert.notEqual(imported.id, campaign.id);
  const importedWorld = await request(`/api/campaigns/${imported.id}`);
  assert.equal(importedWorld.characters.length, restored.characters.length);
  assert.equal(importedWorld.missions.length, restored.missions.length);
});

test('natural-language turn falls back safely while preserving a trace', async () => {
  const campaigns = await request('/api/campaigns');
  const campaign = await request(`/api/campaigns/${campaigns[0].id}`);
  const hero = campaign.characters.find((entry) => entry.role === 'protagonist');
  const result = await request(`/api/campaigns/${campaign.id}/input`, { method: 'POST', body: JSON.stringify({ actorId: hero.id, text: 'osserva con attenzione' }) });
  assert.equal(result.intent.action, 'observe');
  assert.match(result.narrative, /Ti trovi in/);
  const traces = await request(`/api/campaigns/${campaign.id}/turns`);
  assert.equal(traces[0].status, 'narrated');
});
