import { useState } from 'react';
import Lightbox from '../Lightbox/Lightbox';
import { getScreenshotUrl } from '../../services/api';
import './ScreenshotThumb.css';

interface ScreenshotThumbProps {
  path: string;
  alt: string;
  maxHeight?: number;
}

export default function ScreenshotThumb({ path, alt, maxHeight = 200 }: ScreenshotThumbProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const src = getScreenshotUrl(path);

  if (error) {
    return (
      <div className="screenshot-thumb-error">
        No se pudo cargar el screenshot
      </div>
    );
  }

  return (
    <>
      <div className="screenshot-thumb" style={{ maxHeight }} onClick={() => setLightboxOpen(true)}>
        {!loaded && <div className="screenshot-thumb-placeholder">Cargando screenshot...</div>}
        <img
          src={src}
          alt={alt}
          className={`screenshot-thumb-img ${loaded ? 'loaded' : ''}`}
          style={{ maxHeight }}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      </div>
      {lightboxOpen && (
        <Lightbox
          src={src}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
