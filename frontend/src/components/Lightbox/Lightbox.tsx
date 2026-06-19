import { useEffect, useCallback } from 'react';
import './Lightbox.css';

interface LightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function Lightbox({ src, alt, onClose }: LightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <img src={src} alt={alt} className="lightbox-image" />
      </div>
    </div>
  );
}
