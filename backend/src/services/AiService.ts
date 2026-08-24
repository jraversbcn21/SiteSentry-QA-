import { logger } from '../logger';

// OpenRouter es compatible con el formato de OpenAI: mismo body, mismo shape de respuesta.
// Los ids con sufijo ':free' no consumen creditos, pero comparten un cupo publico entre
// todos los usuarios de OpenRouter y devuelven 429 con facilidad (probado 2026-08-24) -
// no se usan como default por eso, aunque siguen disponibles para quien quiera elegirlos.
export var ALLOWED_MODELS = [
  'google/gemini-2.5-flash-lite',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat-v3-0324',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
];

var OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
var DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
var REQUEST_TIMEOUT_MS = 20000;

export class AiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface ExplainInput {
  type: string;
  severity: string;
  description: string;
  url: string;
  model?: string;
}

export function getAiStatus(): { configured: boolean; defaultModel: string } {
  return {
    configured: Boolean(process.env.OPENROUTER_API_KEY),
    defaultModel: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  };
}

function buildPrompt(input: ExplainInput): string {
  return 'Explica en espanol y de forma breve (2-3 oraciones) que significa el siguiente problema de QA detectado en una pagina web y como solucionarlo:\n\n' +
    'Tipo: ' + input.type + '\n' +
    'Severidad: ' + input.severity + '\n' +
    'Descripcion: ' + input.description + '\n' +
    'URL: ' + input.url;
}

export async function explainWithAi(input: ExplainInput): Promise<string> {
  var apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiError('IA no configurada en el servidor', 503);
  }

  var model = input.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  if (ALLOWED_MODELS.indexOf(model) === -1) {
    throw new AiError('Modelo no permitido: ' + model, 400);
  }

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    var response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        // Opcionales de OpenRouter: atribuyen el uso a esta app en su dashboard
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
        'X-Title': 'SiteSentry QA',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'Eres un experto en QA y calidad web. Responde siempre en espanol, de forma breve y directa.' },
          { role: 'user', content: buildPrompt(input) },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      var errorBody = await response.text();
      logger.error('OpenRouter respondio ' + response.status + ': ' + errorBody);
      throw new AiError('Error del servicio de IA', 502);
    }

    var data = await response.json() as any;
    return data.choices?.[0]?.message?.content || 'No se pudo generar una explicacion.';
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AiError('El servicio de IA no respondio a tiempo', 504);
    }
    logger.error('Fallo la llamada a OpenRouter: ' + (err as Error).message);
    throw new AiError('El servicio de IA no respondio a tiempo', 504);
  } finally {
    clearTimeout(timeout);
  }
}
