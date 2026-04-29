import { useState } from 'react';
import './URLInput.css';

interface URLInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onSubmit, isLoading }: URLInputProps) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');

  const validateUrl = (value: string): boolean => {
    try {
      const u = new URL(value);
      if (!['http:', 'https:'].includes(u.protocol)) {
        setUrlError('La URL debe comenzar con http:// o https://');
        return false;
      }
      setUrlError('');
      return true;
    } catch {
      setUrlError('URL invalida. Ejemplo: https://ejemplo.com/pagina');
      return false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setUrlError('Ingresa una URL');
      return;
    }
    if (!validateUrl(trimmedUrl)) return;
    onSubmit(trimmedUrl);
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    if (urlError) setUrlError('');
  };

  return (
    <form className="url-input-form" onSubmit={handleSubmit}>
      <div className="url-input-main">
        <div className={`url-input-wrapper ${urlError ? 'has-error' : ''}`}>
          <span className="url-input-prefix">🌐</span>
          <input
            type="text"
            className="url-input-field"
            placeholder="https://ejemplo.com/pagina-a-analizar"
            value={url}
            onChange={handleUrlChange}
            disabled={isLoading}
            autoFocus
            autoComplete="url"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          className="url-input-submit"
          disabled={isLoading || !url.trim()}
        >
          {isLoading ? (
            <>
              <span className="spinner" />
              Iniciando...
            </>
          ) : (
            <>
              <span>🔍</span>
              Analizar pagina
            </>
          )}
        </button>
      </div>

      {urlError && <p className="url-input-error">{urlError}</p>}

      <p className="url-input-hint">
        Ingresa la URL exacta de la pagina que quieres analizar. Solo se analizara esa pagina, sin seguir enlaces.
      </p>
    </form>
  );
}
