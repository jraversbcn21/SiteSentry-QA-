import { ScanStatus } from '../../types';
import './ScanProgress.css';

interface ScanProgressProps {
  scanId: string;
  url: string;
  status: ScanStatus;
  progress?: { phase: string } | null;
  onCancel: () => void;
}

const phaseLabels: Record<string, string> = {
  launching_browser: 'Iniciando navegador...',
  loading_page: 'Cargando pagina y capturando red...',
  running_checks: 'Ejecutando verificaciones funcionales...',
  saving_results: 'Guardando resultados...',
};

export default function ScanProgress({ url, status, progress, onCancel }: ScanProgressProps) {
  const getStatusMessage = () => {
    switch (status) {
      case ScanStatus.PENDING:
        return { icon: '⏳', text: 'En cola, esperando inicio...', color: '#f59e0b' };
      case ScanStatus.RUNNING: {
        const phaseText = progress?.phase ? phaseLabels[progress.phase] || 'Analizando...' : 'Analizando pagina...';
        return { icon: '🔄', text: phaseText, color: '#2563eb' };
      }
      case ScanStatus.COMPLETED:
        return { icon: '✅', text: 'Analisis completado! Redirigiendo...', color: '#16a34a' };
      case ScanStatus.FAILED:
        return { icon: '❌', text: 'El analisis fallo', color: '#dc2626' };
      default:
        return { icon: '⏳', text: 'Procesando...', color: '#94a3b8' };
    }
  };

  const { icon, text, color } = getStatusMessage();
  const isRunning = status === ScanStatus.RUNNING || status === ScanStatus.PENDING;

  return (
    <div className="scan-progress">
      <div className="scan-progress-header">
        <div className="scan-progress-status" style={{ color }}>
          <span className={`status-icon ${isRunning ? 'spinning' : ''}`}>{icon}</span>
          <span>{text}</span>
        </div>
        <div className="scan-progress-url">{url}</div>
      </div>

      <div className="scan-progress-bar-container">
        <div className="scan-progress-bar indeterminate" style={{ backgroundColor: color }} />
      </div>

      {isRunning && (
        <div className="scan-progress-actions">
          <p className="scan-progress-hint">
            Analizando una sola pagina. Suele tardar entre 10-60 segundos.
          </p>
          <button className="cancel-button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
