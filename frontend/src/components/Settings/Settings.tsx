import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import './Settings.css';

// Debe coincidir con ALLOWED_MODELS en backend/src/services/AiService.ts
// Los ':free' comparten cupo publico en OpenRouter y devuelven 429 con facilidad
// (probado 2026-08-24) - se listan al final, no como recomendados por defecto.
const AI_MODELS = [
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (recomendado, rapido)' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (potente)' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3 (razonamiento)' },
  { value: 'qwen/qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B (economico)' },
  { value: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (gratis, cupo compartido inestable)' },
  { value: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (gratis, cupo compartido inestable)' },
];

const MODEL_KEY = 'sitesentry_ai_model';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

interface AiStatus {
  configured: boolean;
  defaultModel: string;
}

export default function Settings() {
  const [model, setModel] = useState(localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL);
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let ignore = false;
    api.get<AiStatus>('/ai/status')
      .then((res) => { if (!ignore) setAiStatus(res.data); })
      .catch(() => { if (!ignore) setAiStatus(null); });
    return () => { ignore = true; };
  }, []);

  function handleSave() {
    localStorage.setItem(MODEL_KEY, model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-page">
      <Link to="/" className="settings-back">← Volver al inicio</Link>
      <h2>Ajustes</h2>
      <p>Configura la integracion con IA para recibir explicaciones de los issues detectados.</p>

      <div className="settings-card">
        <h3>🤖 OpenRouter API</h3>
        <p className="card-desc">La API key de OpenRouter se configura en el servidor (variable de entorno OPENROUTER_API_KEY).</p>
        {aiStatus && (
          aiStatus.configured
            ? <p className="card-desc ai-status-ok">✓ IA configurada en el servidor (modelo por defecto: {aiStatus.defaultModel})</p>
            : <p className="card-desc ai-status-error">⚠ IA no configurada en el servidor (falta OPENROUTER_API_KEY)</p>
        )}
        <div className="settings-field">
          <label>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {AI_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <button className="settings-save" onClick={handleSave}>
          Guardar
        </button>
        {saved && <span className="settings-saved">✓ Guardado</span>}
      </div>
    </div>
  );
}
