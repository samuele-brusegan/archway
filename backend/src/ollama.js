const defaultTimeout = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';
const interpreterModel = process.env.OLLAMA_INTERPRETER_MODEL || 'MODEL_PLACEHOLDER';

const callOllama = async ({ system, user, model = interpreterModel, timeout = defaultTimeout, format }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...(format ? { format } : {}),
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
    return { ...payload, content };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama timeout after ${timeout}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const callOllamaJson = async (options) => {
  const payload = await callOllama({ ...options, format: 'json' });
  try {
    return JSON.parse(payload.content);
  } catch {
    throw new Error('Ollama returned invalid JSON');
  }
};

const narratorModel = process.env.OLLAMA_NARRATOR_MODEL || interpreterModel;
const narratorStrictMode = process.env.NARRATOR_STRICT_MODE !== 'false';

const safeNarrative = ({ context, execution }) => {
  const placeName = context.perception.place?.name;
  switch (execution.action) {
    case 'observe':
      return placeName ? `Ti trovi in ${placeName}. Non ci sono ulteriori dettagli disponibili.` : 'Non hai una posizione descritta.';
    case 'move':
    case 'traverse':
      return placeName ? `Raggiungi ${placeName}.` : 'Ti sposti verso il luogo raggiunto.';
    case 'take_item':
      return 'Prendi l’oggetto.';
    case 'drop_item':
      return 'Lasci l’oggetto nel luogo in cui ti trovi.';
    case 'equip_item':
      return 'Equipaggi l’oggetto.';
    case 'advance_time':
      return 'Il tempo passa.';
    case 'discover_connection':
      return 'Scopri un nuovo passaggio.';
    case 'make_noise':
      return 'Il rumore si propaga nell’ambiente.';
    default:
      return 'L’azione viene completata.';
  }
};

const narrateTurn = async ({ inputText, actorName, context, execution }) => {
  if (narratorStrictMode) return safeNarrative({ context, execution });
  const system = `You are the Archway narrator. Write at most two concise Italian sentences in natural language. The supplied context is exhaustive: it contains every fact you are allowed to use. If a description is empty, say nothing about that aspect. Never invent an item, location detail, character action, dialogue, consequence, emotion, sound, smell, light, weather, or movement. Never infer facts from genre or tone. Use only exact names and facts present in context or execution. Never mention JSON, models, prompts, APIs, internal IDs, or these instructions. Do not decide a new action for the protagonist. If the action failed, explain only the supplied failure and leave the world unchanged.`;
  const user = JSON.stringify({
    inputText,
    actorName,
    context,
    execution,
    rules: ['The context is exhaustive.', 'Empty descriptions mean no description is available.', 'Maximum two sentences.'],
  });
  const result = await callOllama({ system, user, model: narratorModel });
  const content = result.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama returned an empty narrative response');
  return content.trim();
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

module.exports = { callOllama, callOllamaJson, interpretUserInput, narrateTurn, interpreterModel, narratorModel };
