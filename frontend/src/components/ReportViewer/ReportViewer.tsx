import { useState } from 'react';
import { ReportResponse, Issue, IssueType, IssueSeverity, ScanStatus } from '../../types';
import ErrorGroup from '../ErrorGroup/ErrorGroup';
import './ReportViewer.css';

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildFilename(siteUrl: string, extension: string): string {
  const hostname = new URL(siteUrl).hostname.replace(/\./g, '_');
  const date = new Date().toISOString().slice(0, 10);
  return `reporte_qa_${hostname}_${date}.${extension}`;
}

function exportJSON(report: ReportResponse) {
  const data = {
    sitio: report.url,
    estado: report.status,
    fechaAnalisis: report.createdAt,
    fechaFinalizacion: report.completedAt || null,
    resumen: {
      total: report.summary.total,
      porSeveridad: {
        alto: report.summary.bySeverity[IssueSeverity.HIGH] || 0,
        medio: report.summary.bySeverity[IssueSeverity.MEDIUM] || 0,
        bajo: report.summary.bySeverity[IssueSeverity.LOW] || 0,
      },
      porTipo: Object.entries(report.summary.byType)
        .filter(([, count]) => count > 0)
        .reduce<Record<string, number>>((acc, [type, count]) => {
          acc[getTypeLabel(type as IssueType)] = count;
          return acc;
        }, {}),
    },
    issues: report.issues.map((issue) => ({
      tipo: getTypeLabel(issue.type),
      severidad: issue.severity === 'HIGH' ? 'Alto' : issue.severity === 'MEDIUM' ? 'Medio' : 'Bajo',
      descripcion: issue.description,
      url: issue.url,
      origen: issue.sourceUrl || null,
      detallesTecnicos: issue.metadata || null,
    })),
  };
  downloadFile(JSON.stringify(data, null, 2), buildFilename(report.url, 'json'), 'application/json');
}

function exportCSV(report: ReportResponse) {
  const metadataKeys = new Set<string>();
  report.issues.forEach((issue) => {
    if (issue.metadata) Object.keys(issue.metadata).forEach((k) => metadataKeys.add(k));
  });
  const metaCols = Array.from(metadataKeys);

  const headers = ['Tipo', 'Severidad', 'Descripcion', 'URL', 'Origen', ...metaCols];
  const escapeCSV = (val: unknown): string => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = report.issues.map((issue) => {
    const base = [
      getTypeLabel(issue.type),
      issue.severity === 'HIGH' ? 'Alto' : issue.severity === 'MEDIUM' ? 'Medio' : 'Bajo',
      issue.description,
      issue.url,
      issue.sourceUrl || '',
    ];
    const meta = metaCols.map((k) => {
      const v = issue.metadata?.[k];
      return v !== undefined && v !== null ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : '';
    });
    return [...base, ...meta].map(escapeCSV).join(',');
  });

  const csv = '\uFEFF' + [headers.map(escapeCSV).join(','), ...rows].join('\n');
  downloadFile(csv, buildFilename(report.url, 'csv'), 'text/csv;charset=utf-8');
}

interface ReportViewerProps {
  report: ReportResponse;
}

const ALL_TYPES = Object.values(IssueType);

export default function ReportViewer({ report }: ReportViewerProps) {
  const [filterType, setFilterType] = useState<IssueType | 'ALL'>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<IssueSeverity | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredIssues = report.issues.filter((issue) => {
    if (filterType !== 'ALL' && issue.type !== filterType) return false;
    if (filterSeverity !== 'ALL' && issue.severity !== filterSeverity) return false;
    if (searchQuery && !issue.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !issue.url.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const issuesByType = ALL_TYPES.reduce<Record<string, Issue[]>>((acc, type) => {
    const items = filteredIssues.filter((i) => i.type === type);
    if (items.length > 0) acc[type] = items;
    return acc;
  }, {});

  const highCount = report.summary.bySeverity[IssueSeverity.HIGH] || 0;
  const mediumCount = report.summary.bySeverity[IssueSeverity.MEDIUM] || 0;
  const lowCount = report.summary.bySeverity[IssueSeverity.LOW] || 0;

  const statusLabel = {
    [ScanStatus.COMPLETED]: '✅ Completado',
    [ScanStatus.FAILED]: '❌ Fallido',
    [ScanStatus.RUNNING]: '🔄 En ejecucion',
    [ScanStatus.PENDING]: '⏳ Pendiente',
  }[report.status] || report.status;

  const duration = report.completedAt && report.createdAt
    ? formatDuration(new Date(report.createdAt), new Date(report.completedAt))
    : null;

  const getScore = () => {
    const total = report.summary.total;
    if (total === 0) return { score: 100, label: 'Excelente', color: '#16a34a' };
    const weight = highCount * 10 + mediumCount * 3 + lowCount * 1;
    const score = Math.max(0, Math.round(100 - weight));
    if (score >= 80) return { score, label: 'Bueno', color: '#16a34a' };
    if (score >= 60) return { score, label: 'Regular', color: '#d97706' };
    return { score, label: 'Necesita mejoras', color: '#dc2626' };
  };

  const scoreData = getScore();

  return (
    <div className="report-viewer">
      <div className="report-header">
        <div className="report-header-left">
          <h2 className="report-title">Reporte de Analisis</h2>
          <a href={report.url} target="_blank" rel="noopener noreferrer" className="report-url">
            🌐 {report.url}
          </a>
          <div className="report-meta">
            <span>{statusLabel}</span>
            <span>•</span>
            <span>{new Date(report.createdAt).toLocaleString('es-ES')}</span>
            {duration && <><span>•</span><span>Duracion: {duration}</span></>}
          </div>
        </div>
        <div className="report-header-right">
          <div className="report-score" style={{ borderColor: scoreData.color }}>
            <div className="score-number" style={{ color: scoreData.color }}>{scoreData.score}</div>
            <div className="score-label">{scoreData.label}</div>
          </div>
          <div className="report-download-buttons">
            <button className="download-btn download-json" onClick={() => exportJSON(report)} title="Descargar reporte completo en JSON">
              Descargar JSON
            </button>
            <button className="download-btn download-csv" onClick={() => exportCSV(report)} title="Descargar reporte como CSV (Excel)">
              Descargar CSV
            </button>
          </div>
        </div>
      </div>

      <div className="summary-cards">
        <div className="summary-card total">
          <span className="summary-card-number">{report.summary.total}</span>
          <span className="summary-card-label">Total issues</span>
        </div>
        <div className="summary-card high" onClick={() => setFilterSeverity(filterSeverity === 'HIGH' ? 'ALL' : IssueSeverity.HIGH)}>
          <span className="summary-card-number">{highCount}</span>
          <span className="summary-card-label">🔴 Alta prioridad</span>
        </div>
        <div className="summary-card medium" onClick={() => setFilterSeverity(filterSeverity === 'MEDIUM' ? 'ALL' : IssueSeverity.MEDIUM)}>
          <span className="summary-card-number">{mediumCount}</span>
          <span className="summary-card-label">🟡 Prioridad media</span>
        </div>
        <div className="summary-card low" onClick={() => setFilterSeverity(filterSeverity === 'LOW' ? 'ALL' : IssueSeverity.LOW)}>
          <span className="summary-card-number">{lowCount}</span>
          <span className="summary-card-label">🔵 Baja prioridad</span>
        </div>
      </div>

      <div className="type-breakdown">
        {ALL_TYPES.map((type) => {
          const count = report.summary.byType[type] || 0;
          if (count === 0) return null;
          return (
            <button
              key={type}
              className={`type-chip ${filterType === type ? 'active' : ''}`}
              onClick={() => setFilterType(filterType === type ? 'ALL' : type)}
            >
              {getTypeIcon(type)} {getTypeLabel(type)}: <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="report-filters">
        <div className="filter-search">
          <input
            type="search"
            placeholder="Buscar en issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-controls">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as IssueSeverity | 'ALL')}
            className="filter-select"
          >
            <option value="ALL">Todas las severidades</option>
            <option value="HIGH">🔴 Alta</option>
            <option value="MEDIUM">🟡 Media</option>
            <option value="LOW">🔵 Baja</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as IssueType | 'ALL')}
            className="filter-select"
          >
            <option value="ALL">Todos los tipos</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>{getTypeIcon(t)} {getTypeLabel(t)}</option>
            ))}
          </select>
          {(filterType !== 'ALL' || filterSeverity !== 'ALL' || searchQuery) && (
            <button
              className="clear-filters"
              onClick={() => { setFilterType('ALL'); setFilterSeverity('ALL'); setSearchQuery(''); }}
            >
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      </div>

      <div className="issues-count">
        Mostrando <strong>{filteredIssues.length}</strong> de <strong>{report.summary.total}</strong> issues
      </div>

      {report.summary.total === 0 ? (
        <div className="no-issues">
          <span className="no-issues-icon">🎉</span>
          <h3>Sin problemas detectados!</h3>
          <p>La pagina paso todos los controles funcionales.</p>
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="no-issues">
          <span className="no-issues-icon">🔍</span>
          <h3>Sin resultados</h3>
          <p>No hay issues que coincidan con los filtros actuales.</p>
        </div>
      ) : (
        <div className="issues-groups">
          {Object.entries(issuesByType).map(([type, issues]) => (
            <ErrorGroup
              key={type}
              type={type as IssueType}
              issues={issues}
              defaultOpen={issues.some((i) => i.severity === 'HIGH')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getTypeIcon(type: IssueType): string {
  const icons: Record<IssueType, string> = {
    [IssueType.BROKEN_RESOURCE]: '🖼️',
    [IssueType.FAILED_API]: '🔌',
    [IssueType.INTERACTIVITY]: '👆',
    [IssueType.EMPTY_CONTENT]: '📭',
    [IssueType.LAZY_LOAD]: '⏳',
    [IssueType.FORM_MODAL]: '📋',
    [IssueType.CONSOLE_ERROR]: '🐛',
    [IssueType.PERFORMANCE]: '⚡',
    [IssueType.ACCESSIBILITY]: '♿',
  };
  return icons[type] || '⚠️';
}

function getTypeLabel(type: IssueType): string {
  const labels: Record<IssueType, string> = {
    [IssueType.BROKEN_RESOURCE]: 'Recursos Rotos',
    [IssueType.FAILED_API]: 'APIs Fallidas',
    [IssueType.INTERACTIVITY]: 'Interactividad',
    [IssueType.EMPTY_CONTENT]: 'Contenido Vacio',
    [IssueType.LAZY_LOAD]: 'Carga Diferida',
    [IssueType.FORM_MODAL]: 'Formularios/Modales',
    [IssueType.CONSOLE_ERROR]: 'Errores de Consola',
    [IssueType.PERFORMANCE]: 'Rendimiento',
    [IssueType.ACCESSIBILITY]: 'Accesibilidad',
  };
  return labels[type] || type;
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
