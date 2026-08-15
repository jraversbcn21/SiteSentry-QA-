import { logger } from '../logger';

export var ALLOWED_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
];

var GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
var DEFAULT_MODEL = 'llama-3.1-8b-instant';
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
    configured: Boolean(process.env.GROQ_API_KEY),
    defaultModel: process.env.GROQ_MODEL || DEFAULT_MODEL,
  };
}

function buildPrompt(input: ExplainInput): string {
  return 'Explica en espanol y de forma breve (2-3 oraciones) que significa el siguiente problema de QA detectado en una pagina web y como solucionarlo:\n\n' +
    'Tipo: ' + input.type + '\n' +
    'Severidad: ' + input.severity + '\n' +
    'Descripcion: ' + input.description + '\n' +
    'URL: ' + input.url;
}

export async function explainWithGroq(input: ExplainInput): Promise<string> {
  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AiError('IA no configurada en el servidor', 503);
  }

  var model = input.model || process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (ALLOWED_MODELS.indexOf(model) === -1) {
    throw new AiError('Modelo no permitido: ' + model, 400);
  }

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    var response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
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
      logger.error('Groq API respondio ' + response.status + ': ' + errorBody);
      throw new AiError('Error del servicio de IA', 502);
    }

    var data = await response.json() as any;
    return data.choices?.[0]?.message?.content || 'No se pudo generar una explicacion.';
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AiError('El servicio de IA no respondio a tiempo', 504);
    }
    logger.error('Fallo la llamada a Groq: ' + (err as Error).message);
    throw new AiError('El servicio de IA no respondio a tiempo', 504);
  } finally {
    clearTimeout(timeout);
  }
}
