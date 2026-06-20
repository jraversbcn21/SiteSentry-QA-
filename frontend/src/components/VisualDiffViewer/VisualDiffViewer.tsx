import { useState } from 'react';
import './VisualDiffViewer.css';

interface VisualDiffViewerProps {
  baselineSrc: string;
  currentSrc: string;
  diffSrc: string;
  diffPercentage: number;
  threshold: number;
  alt: string;
  maxHeight?: number;
  compact?: boolean;
}

export default function VisualDiffViewer({
  baselineSrc,
  currentSrc,
  diffSrc,
  diffPercentage,
  threshold,
  alt,
  maxHeight = 400,
  compact = false,
}: VisualDiffViewerProps) {
  const [sliderPos, setSliderPos] = useState(50);

  const exceeded = diffPercentage > threshold * 100;
  const isOverlayReady = baselineSrc && currentSrc;

  return (
    <div className={`visual-diff-viewer${compact ? ' compact' : ''}`}>
      {isOverlayReady && (
        <>
          <div className="vd-slider-container" style={{ maxHeight }}>
            <div className="vd-slider-current">
              <img src={`/screenshots/${currentSrc}`} alt={`Actual: ${alt}`} style={{ maxHeight }} />
            </div>
            <div className="vd-slider-baseline" style={{ width: `${sliderPos}%` }}>
              <img src={`/screenshots/${baselineSrc}`} alt={`Baseline: ${alt}`} style={{ maxHeight }} />
            </div>
            <div className="vd-slider-line" style={{ left: `${sliderPos}%` }} />
            <div className="vd-slider-handle" style={{ left: `${sliderPos}%` }} />
            <input
              type="range"
              className="vd-slider-range"
              min={0}
              max={100}
              value={sliderPos}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              aria-label="Comparar baseline vs actual"
            />
          </div>
          <div className="vd-labels">
            <span>Baseline</span>
            <span>Actual</span>
          </div>
        </>
      )}

      <div className="vd-diff-section">
        <div className="vd-diff-header">
          <span className={`vd-diff-badge ${exceeded ? 'over' : 'under'}`}>
            {exceeded ? '⚠' : '✓'} {diffPercentage.toFixed(1)}%
          </span>
          <span className="vd-threshold-info">Umbral: {(threshold * 100).toFixed(1)}%</span>
        </div>
        <div className="vd-diff-image-container" style={{ maxHeight }}>
          <img src={`/screenshots/${diffSrc}`} alt={`Diff: ${alt}`} style={{ maxHeight }} />
        </div>
      </div>
    </div>
  );
}
