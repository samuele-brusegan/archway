const ACTIONS = new Set([
  'observe', 'move', 'traverse', 'take_item', 'drop_item', 'equip_item',
  'advance_time', 'discover_connection', 'make_noise',
]);

class ContractError extends Error {
  constructor(message, path = '$') {
    super(message);
    this.code = 'CONTRACT_INVALID';
    this.path = path;
  }
}

const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Expected an object', path);
  return value;
};

const string = (value, path, required = true) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) throw new ContractError('Expected a non-empty string', path);
  return value.trim();
};

const number = (value, path, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ContractError(`Expected a number between ${min} and ${max}`, path);
  return value;
};

const array = (value, path) => {
  if (!Array.isArray(value)) throw new ContractError('Expected an array', path);
  return value;
};

const validateCommand = (payload) => {
  const input = object(payload, '$');
  const actorId = string(input.actorId, '$.actorId');
  const action = string(input.action, '$.action');
  if (!ACTIONS.has(action)) throw new ContractError(`Unsupported action: ${action}`, '$.action');
  const result = { actorId, action };
  if (action === 'move') result.targetPlaceId = string(input.targetPlaceId, '$.targetPlaceId');
  if (action === 'traverse') result.connectionId = string(input.connectionId, '$.connectionId');
  if (['take_item', 'drop_item', 'equip_item'].includes(action)) result.itemId = string(input.itemId, '$.itemId');
  if (action === 'advance_time') result.seconds = number(input.seconds, '$.seconds', 1, 2592000);
  if (action === 'discover_connection') result.connectionId = string(input.connectionId, '$.connectionId');
  if (action === 'make_noise') {
    result.intensity = number(input.intensity, '$.intensity', 1, 100);
    result.description = string(input.description, '$.description', false) || 'Un rumore';
  }
  return result;
};

const validateIntent = (payload) => {
  const input = object(payload, '$');
  const result = {
    type: 'intent',
    actorId: string(input.actorId, '$.actorId'),
    action: string(input.action, '$.action'),
    confidence: input.confidence === undefined ? 1 : number(input.confidence, '$.confidence', 0, 1),
  };
  if (!ACTIONS.has(result.action)) throw new ContractError(`Unsupported action: ${result.action}`, '$.action');
  for (const field of ['targetPlaceId', 'connectionId', 'itemId']) {
    if (input[field] !== undefined) result[field] = string(input[field], `$.${field}`);
  }
  if (result.action === 'move' && !result.targetPlaceId) throw new ContractError('targetPlaceId is required for move', '$.targetPlaceId');
  if (result.action === 'traverse' && !result.connectionId) throw new ContractError('connectionId is required for traverse', '$.connectionId');
  if (['take_item', 'drop_item', 'equip_item'].includes(result.action) && !result.itemId) throw new ContractError('itemId is required for item action', '$.itemId');
  if (result.action === 'advance_time') result.seconds = number(input.seconds, '$.seconds', 1, 2592000);
  if (result.action === 'make_noise') {
    result.intensity = number(input.intensity, '$.intensity', 1, 100);
    result.description = string(input.description, '$.description', false) || 'Un rumore';
  }
  return result;
};

const validateEvent = (payload) => {
  const input = object(payload, '$');
  const visibility = input.visibility || 'public';
  if (!['public', 'private', 'secret'].includes(visibility)) throw new ContractError('Invalid visibility', '$.visibility');
  return {
    type: string(input.type, '$.type'),
    actorId: string(input.actorId, '$.actorId', false) || null,
    payload: object(input.payload || {}, '$.payload'),
    visibility,
  };
};

const validatePatch = (payload) => {
  const input = object(payload, '$');
  if (input.operation !== 'update_character') throw new ContractError('Only update_character patches are supported', '$.operation');
  const changes = object(input.changes, '$.changes');
  if (!Object.keys(changes).length) throw new ContractError('Patch cannot be empty', '$.changes');
  return {
    operation: input.operation,
    characterId: string(input.characterId, '$.characterId'),
    changes,
    reasonEventId: string(input.reasonEventId, '$.reasonEventId', false) || null,
  };
};

const validateSummary = (payload) => {
  const input = object(payload, '$');
  const list = (name) => array(input[name] || [], `$.${name}`).filter((value) => typeof value === 'string');
  return {
    sceneSummary: string(input.sceneSummary, '$.sceneSummary'),
    confirmedFacts: list('confirmedFacts'),
    assumptions: list('assumptions'),
    openQuestions: list('openQuestions'),
    activeThreats: list('activeThreats'),
    activeGoals: list('activeGoals'),
    unresolvedContradictions: list('unresolvedContradictions'),
    recentChanges: list('recentChanges'),
  };
};

const validators = { command: validateCommand, intent: validateIntent, event: validateEvent, patch: validatePatch, summary: validateSummary };

const validateContract = (type, payload) => {
  if (!validators[type]) throw new ContractError(`Unknown contract: ${type}`, '$.type');
  return validators[type](payload);
};

module.exports = { ACTIONS, ContractError, validateContract };
