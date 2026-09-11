const defaultTimeout = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';
const interpreterModel = process.env.OLLAMA_INTERPRETER_MODEL || 'MODEL_PLACEHOLDER';

const callOllamaJson = async ({ system, user, model = interpreterModel, timeout = defaultTimeout }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ollama returned HTTP ${response.status}`);
    const content = payload.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama returned an empty response');
    try {
      return JSON.parse(content);
    } catch {
      throw new Error('Ollama returned invalid JSON');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama timeout after ${timeout}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const interpretUserInput = async ({ actorId, text, perception }) => {
  const system = `You are Archway's command interpreter. Convert the user's Italian natural-language action into exactly one JSON object. Never narrate. Never invent IDs. Use only the listed action names and IDs. If the request is unclear, use action "observe" with confidence 0.0. Allowed actions: observe, move, traverse, take_item, drop_item, equip_item, advance_time, discover_connection, make_noise.`;
  const user = JSON.stringify({
    actorId,
    text,
    availableContext: {
      currentPlace: perception.place ? { id: perception.place.id, name: perception.place.name } : null,
      visibleItems: perception.items.map((item) => ({ id: item.id, name: item.name })),
      visibleConnections: perception.connections.map((connection) => ({ id: connection.id, name: connection.name })),
      knownCharacters: perception.knowledge.filter((item) => item.subject_type === 'character').map((item) => item.subject_id),
    },
    outputShape: {
      actorId,
      action: 'one allowed action',
      confidence: 'number from 0 to 1',
      targetPlaceId: 'only when moving',
      connectionId: 'only when traversing or discovering',
      itemId: 'only when using inventory',
      seconds: 'only when advancing time',
      intensity: 'only when making noise',
    },
  });
  return callOllamaJson({ system, user });
};

module.exports = { callOllamaJson, interpretUserInput, interpreterModel };
