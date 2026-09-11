const { randomUUID } = require('node:crypto');
const { db } = require('./db');
const { callOllamaJson, narratorModel } = require('./ollama');

const now = () => new Date().toISOString();

const fallbackDescription = (place, campaign) => {
  const kind = place.kind && place.kind !== 'place' ? place.kind : 'luogo';
  const tone = campaign.tone ? ` L'atmosfera richiama un tono ${campaign.tone}.` : '';
  return `È un ${kind} chiamato ${place.name}, ancora da esplorare.${tone}`;
};

const enrichPlace = async (campaignId, characterId, placeId) => {
  const place = db.prepare('SELECT * FROM places WHERE id = ? AND campaign_id = ?').get(placeId, campaignId);
  const placeholderDescriptions = new Set(['Il luogo iniziale della storia.', 'Il luogo iniziale della storia']);
  if (!place || (place.description.trim() && !placeholderDescriptions.has(place.description.trim()))) return { enriched: false, place };
  const campaign = db.prepare('SELECT title, genre, tone, premise FROM campaigns WHERE id = ?').get(campaignId);
  let description;
  let source = 'fallback';
  try {
    const generated = await callOllamaJson({
      model: narratorModel,
      system: 'Sei il world builder di Archway. Restituisci solo JSON valido con description e details. Crea dettagli percettivi sobri e coerenti con il nome del luogo, il genere e il tono forniti. Non creare personaggi, oggetti, eventi, minacce o passaggi nuovi. Non descrivere ciò che il protagonista non può percepire. Massimo 70 parole complessive.',
      user: JSON.stringify({ place: { name: place.name, kind: place.kind }, campaign }),
    });
    if (typeof generated.description !== 'string' || !generated.description.trim()) throw new Error('World builder returned no description');
    const details = Array.isArray(generated.details) ? generated.details.filter((item) => typeof item === 'string' && item.trim()).slice(0, 3) : [];
    description = [generated.description.trim(), ...details].join(' ');
    if (description.length > 1000) description = description.slice(0, 997) + '...';
    source = 'local-model';
  } catch {
    description = fallbackDescription(place, campaign);
  }
  const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE places SET description = ?, updated_at = ? WHERE id = ? AND campaign_id = ?').run(description, timestamp, place.id, campaignId);
    db.prepare(`INSERT INTO events (id, campaign_id, type, actor_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), campaignId, 'place.details_discovered', characterId || null, JSON.stringify({ placeId: place.id, source, description }), timestamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { enriched: true, place: db.prepare('SELECT * FROM places WHERE id = ?').get(place.id) };
};

module.exports = { enrichPlace };
