const { validateContract } = require('./contracts');

const simulate = (task, input = {}) => {
  if (task === 'interpret') {
    const text = String(input.text || '').toLowerCase();
    let action = 'observe';
    if (/\b(apri|apriamo|apre|aprire)\b/.test(text)) action = 'observe';
    if (/\b(osserv|guard|ved)/.test(text)) action = 'observe';
    if (/\b(prendi|raccogli|afferra)/.test(text)) action = 'take_item';
    if (/\b(lascia|molla)/.test(text)) action = 'drop_item';
    if (/\b(equipaggia|indossa)/.test(text)) action = 'equip_item';
    return validateContract('intent', { type: 'intent', actorId: input.actorId || 'actor.pending', action, confidence: 0.5 });
  }
  if (task === 'event') {
    return validateContract('event', { type: input.eventType || 'simulation.event', actorId: input.actorId, payload: input.payload || {}, visibility: input.visibility });
  }
  if (task === 'patch') {
    return validateContract('patch', { operation: 'update_character', characterId: input.characterId || 'character.pending', changes: input.changes || { 'state.simulated': true }, reasonEventId: input.reasonEventId });
  }
  if (task === 'summary') {
    return validateContract('summary', { sceneSummary: input.sceneSummary || 'Scena simulata.', confirmedFacts: input.confirmedFacts || [], assumptions: input.assumptions || [], openQuestions: input.openQuestions || [], activeThreats: input.activeThreats || [], activeGoals: input.activeGoals || [], unresolvedContradictions: input.unresolvedContradictions || [], recentChanges: input.recentChanges || [] });
  }
  throw new Error(`Unknown simulation task: ${task}`);
};

module.exports = { simulate };
