const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const databasePath = path.join(dataDir, 'archway.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT '',
        premise TEXT NOT NULL DEFAULT '',
        current_time TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'npc',
        physical_description TEXT NOT NULL DEFAULT '',
        psychological_description TEXT NOT NULL DEFAULT '',
        state_json TEXT NOT NULL DEFAULT '{}',
        location_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE places (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES places(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'place',
        description TEXT NOT NULL DEFAULT '',
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE place_connections (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        from_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        to_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(from_place_id, to_place_id, name)
      );

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        state_json TEXT NOT NULL DEFAULT '{}',
        location_id TEXT,
        owner_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        source TEXT NOT NULL DEFAULT 'user',
        reliability REAL NOT NULL DEFAULT 1.0,
        importance INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'active',
        location_id TEXT,
        occurred_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        from_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        to_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(from_character_id, to_character_id)
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'public',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_characters_campaign ON characters(campaign_id);
      CREATE INDEX idx_places_campaign ON places(campaign_id);
      CREATE INDEX idx_memories_character_status ON memories(character_id, status);
      CREATE INDEX idx_events_campaign_created ON events(campaign_id, created_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE knowledge (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL,
        subject_id TEXT,
        knowledge_type TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        certainty REAL NOT NULL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_knowledge_character_status ON knowledge(character_id, status);
      CREATE UNIQUE INDEX idx_knowledge_character_subject ON knowledge(character_id, subject_type, subject_id, knowledge_type);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE context_summaries (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        summary_json TEXT NOT NULL,
        token_budget INTEGER NOT NULL DEFAULT 1000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(campaign_id, scope_type, scope_id)
      );

      CREATE INDEX idx_context_summaries_scope ON context_summaries(campaign_id, scope_type, scope_id);
    `,
  },
];

const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
for (const migration of migrations) {
  if (applied.has(migration.version)) continue;
  db.exec('BEGIN');
  try {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(migration.version, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const tableCounts = () => {
  const tables = ['campaigns', 'characters', 'places', 'place_connections', 'items', 'memories', 'relationships', 'knowledge', 'context_summaries', 'events'];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
};

module.exports = { db, databasePath, tableCounts };
