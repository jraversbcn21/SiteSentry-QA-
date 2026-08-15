import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import './Settings.css';

const GROQ_MODELS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (rapido)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (potente)' },
  { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B (razonamiento)' },
  { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
  { value: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B' },
];

interface AiStatus {
  configured: boolean;
  defaultModel: string;
}

export default function Settings() {
  const [model, setModel] = useState(localStorage.getItem('sitesentry_groq_model') || 'llama-3.1-8b-instant');
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
    localStorage.setItem('sitesentry_groq_model', model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-page">
      <Link to="/" className="settings-back">← Volver al inicio</Link>
      <h2>Ajustes</h2>
      <p>Configura la integracion con IA para recibir explicaciones de los issues detectados.</p>

      <div className="settings-card">
        <h3>🤖 Groq API</h3>
        <p className="card-desc">La API key de Groq se configura en el servidor (variable de entorno GROQ_API_KEY).</p>
        {aiStatus && (
          aiStatus.configured
            ? <p className="card-desc ai-status-ok">✓ IA configurada en el servidor (modelo por defecto: {aiStatus.defaultModel})</p>
            : <p className="card-desc ai-status-error">⚠ IA no configurada en el servidor (falta GROQ_API_KEY)</p>
        )}
        <div className="settings-field">
          <label>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {GROQ_MODELS.map((m) => (
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
