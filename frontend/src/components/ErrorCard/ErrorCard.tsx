import { Issue, IssueSeverity, IssueType } from '../../types';
import './ErrorCard.css';

interface ErrorCardProps {
  issue: Issue;
}

export default function ErrorCard({ issue }: ErrorCardProps) {
  const severityConfig = {
    [IssueSeverity.HIGH]: { label: 'Alto', className: 'severity-high', icon: '🔴' },
    [IssueSeverity.MEDIUM]: { label: 'Medio', className: 'severity-medium', icon: '🟡' },
    [IssueSeverity.LOW]: { label: 'Bajo', className: 'severity-low', icon: '🔵' },
  };

  const typeConfig: Record<IssueType, { label: string; icon: string }> = {
    [IssueType.BROKEN_RESOURCE]: { label: 'Recurso Roto', icon: '🖼️' },
    [IssueType.FAILED_API]: { label: 'API Fallida', icon: '🔌' },
    [IssueType.INTERACTIVITY]: { label: 'Interactividad', icon: '👆' },
    [IssueType.EMPTY_CONTENT]: { label: 'Contenido Vacio', icon: '📭' },
    [IssueType.LAZY_LOAD]: { label: 'Carga Diferida', icon: '⏳' },
    [IssueType.FORM_MODAL]: { label: 'Formulario/Modal', icon: '📋' },
  };

  const sev = severityConfig[issue.severity] || severityConfig[IssueSeverity.LOW];
  const type = typeConfig[issue.type] || { label: issue.type, icon: '⚠️' };

  const urlShortened = issue.url.length > 80 ? issue.url.slice(0, 77) + '...' : issue.url;
  const sourceShortened = issue.sourceUrl && issue.sourceUrl.length > 80
    ? issue.sourceUrl.slice(0, 77) + '...'
    : issue.sourceUrl;

  return (
    <div className={`error-card ${sev.className}`}>
      <div className="error-card-header">
        <div className="error-card-badges">
          <span className={`severity-badge ${sev.className}`}>
            {sev.icon} {sev.label}
          </span>
          <span className="type-badge">
            {type.icon} {type.label}
          </span>
        </div>
      </div>

      <p className="error-card-description">{issue.description}</p>

      <div className="error-card-url">
        <span className="url-label">URL:</span>
        <a href={issue.url} target="_blank" rel="noopener noreferrer" className="url-link" title={issue.url}>
          {urlShortened}
        </a>
      </div>

      {sourceShortened && (
        <div className="error-card-url">
          <span className="url-label">Origen:</span>
          <a href={issue.sourceUrl} target="_blank" rel="noopener noreferrer" className="url-link source" title={issue.sourceUrl}>
            {sourceShortened}
          </a>
        </div>
      )}

      {issue.metadata && Object.keys(issue.metadata).length > 0 && (
        <details className="error-card-metadata">
          <summary>Detalles tecnicos</summary>
          <div className="metadata-table">
            {Object.entries(issue.metadata).map(([key, value]) => (
              <div className="metadata-row" key={key}>
                <span className="metadata-key">{formatMetadataKey(key)}</span>
                <span className="metadata-value">{formatMetadataValue(key, value)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const metadataKeyLabels: Record<string, string> = {
  selector: 'Selector CSS',
  hasCloseButton: 'Boton de cierre',
  text: 'Texto',
  src: 'Fuente (src)',
  dataSrc: 'Data-src',
  width: 'Ancho',
  height: 'Alto',
  displayWidth: 'Ancho visible',
  naturalWidth: 'Ancho real',
  className: 'Clase CSS',
  tag: 'Elemento',
  id: 'ID',
  formId: 'ID formulario',
  inputCount: 'Campos',
  action: 'Action',
  method: 'Metodo HTTP',
  statusCode: 'Codigo estado',
  statusText: 'Estado',
  timing: 'Tiempo (ms)',
  error: 'Error',
  failureText: 'Detalle error',
  opacity: 'Opacidad',
  cursor: 'Cursor',
  href: 'Enlace (href)',
  possibleCORS: 'Posible CORS',
  duration: 'Duracion (ms)',
  found: 'Encontrado',
  position: 'Posicion CSS',
  mimeType: 'Tipo MIME',
  size: 'Tamano',
  resourceType: 'Tipo recurso',
};

function formatMetadataKey(key: string): string {
  return metadataKeyLabels[key] || key;
}

function formatMetadataValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  if (key === 'timing' || key === 'duration') return `${Number(value).toLocaleString()} ms`;
  if (key === 'size' && typeof value === 'number') {
    if (value === 0) return '-';
    if (value > 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if ((key === 'width' || key === 'height' || key === 'displayWidth' || key === 'naturalWidth') && typeof value === 'number') {
    return `${value}px`;
  }
  if (key === 'statusCode' && typeof value === 'number') {
    if (value >= 500) return `${value} (Error servidor)`;
    if (value >= 400) return `${value} (Error cliente)`;
    return `${value}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
