import type { Issue } from '../types';
import api, { unwrapApiError } from './api';

// Clave distinta a la de Groq: un modelo Groq guardado ya no esta en la whitelist
// del backend y provocaria un 400, asi que el valor viejo se descarta solo.
const MODEL_KEY = 'sitesentry_ai_model';
const DEFAULT_MODEL = 'google/gemma-4-31b-it:free';

function getModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_KEY);
    return stored || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export async function explainIssue(issue: Issue): Promise<string> {
  try {
    const response = await api.post<{ explanation: string }>('/ai/explain', {
      type: issue.type,
      severity: issue.severity,
      description: issue.description,
      url: issue.url,
      model: getModel(),
    });
    return response.data.explanation || 'No se pudo generar una explicacion.';
  } catch (err) {
    throw new Error(unwrapApiError(err));
  }
}
