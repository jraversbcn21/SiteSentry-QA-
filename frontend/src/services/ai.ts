import type { Issue } from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getApiKey(): string | null {
  try {
    const stored = localStorage.getItem('sitesentry_groq_api_key');
    return stored || null;
  } catch {
    return null;
  }
}

function getModel(): string {
  try {
    const stored = localStorage.getItem('sitesentry_groq_model');
    return stored || 'llama-3.1-8b-instant';
  } catch {
    return 'llama-3.1-8b-instant';
  }
}

export async function explainIssue(issue: Issue): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key de Groq no configurada. Configurala en Ajustes.');
  }

  const model = getModel();

  const prompt = 'Explica en espanol y de forma breve (2-3 oraciones) que significa el siguiente problema de QA detectado en una pagina web y como solucionarlo:\n\n' +
    'Tipo: ' + issue.type + '\n' +
    'Severidad: ' + issue.severity + '\n' +
    'Descripcion: ' + issue.description + '\n' +
    'URL: ' + issue.url;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'Eres un experto en QA y calidad web. Responde siempre en espanol, de forma breve y directa.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('Error de Groq API (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No se pudo generar una explicacion.';
}
