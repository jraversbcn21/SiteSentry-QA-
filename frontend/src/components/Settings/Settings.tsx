import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Settings.css';

const GROQ_MODELS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (rapido)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (potente)' },
  { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B (razonamiento)' },
  { value: 'gpt-oss-120b', label: 'GPT OSS 120B' },
  { value: 'qwen-2.5-32b', label: 'Qwen 2.5 32B' },
];

export default function Settings() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('sitesentry_groq_api_key') || '');
  const [model, setModel] = useState(localStorage.getItem('sitesentry_groq_model') || 'llama-3.1-8b-instant');
  const [saved, setSaved] = useState(false);

  function handleSave() {
    localStorage.setItem('sitesentry_groq_api_key', apiKey.trim());
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
        <p className="card-desc">Necesitas una API key gratuita de Groq para usar las explicaciones con IA.</p>
        <div className="settings-field">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="gsk_..."
          />
        </div>
        <div className="settings-field">
          <label>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {GROQ_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <button className="settings-save" onClick={handleSave} disabled={!apiKey.trim()}>
          Guardar
        </button>
        {saved && <span className="settings-saved">✓ Guardado</span>}
      </div>
    </div>
  );
}
