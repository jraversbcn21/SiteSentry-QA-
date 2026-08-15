import type { Issue } from '../types';
import api, { unwrapApiError } from './api';

function getModel(): string {
  try {
    const stored = localStorage.getItem('sitesentry_groq_model');
    return stored || 'llama-3.1-8b-instant';
  } catch {
    return 'llama-3.1-8b-instant';
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
