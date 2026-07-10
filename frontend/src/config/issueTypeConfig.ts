import { IssueType, IssueSeverity, ScanStatus } from '../types';

export const typeConfig: Record<IssueType, { label: string; icon: string; color: string }> = {
  [IssueType.BROKEN_RESOURCE]: { label: 'Recursos Rotos', icon: '🖼️', color: '#ef4444' },
  [IssueType.FAILED_API]: { label: 'APIs Fallidas', icon: '🔌', color: '#f97316' },
  [IssueType.INTERACTIVITY]: { label: 'Interactividad', icon: '👆', color: '#eab308' },
  [IssueType.EMPTY_CONTENT]: { label: 'Contenido Vacio', icon: '📭', color: '#8b5cf6' },
  [IssueType.LAZY_LOAD]: { label: 'Carga Diferida', icon: '⏳', color: '#06b6d4' },
  [IssueType.FORM_MODAL]: { label: 'Formularios/Modales', icon: '📋', color: '#10b981' },
  [IssueType.CONSOLE_ERROR]: { label: 'Errores de Consola', icon: '🐛', color: '#dc2626' },
  [IssueType.PERFORMANCE]: { label: 'Rendimiento', icon: '⚡', color: '#d97706' },
  [IssueType.ACCESSIBILITY]: { label: 'Accesibilidad', icon: '♿', color: '#7c3aed' },
  [IssueType.FLOW_ERROR]: { label: 'Error de Flujo', icon: '🔀', color: '#dc2626' },
};

export function getTypeIcon(type: IssueType): string {
  return typeConfig[type]?.icon || '⚠️';
}

export function getTypeLabel(type: IssueType): string {
  return typeConfig[type]?.label || type;
}

export const severityConfig: Record<IssueSeverity, { label: string; className: string; icon: string }> = {
  [IssueSeverity.HIGH]: { label: 'Alto', className: 'severity-high', icon: '🔴' },
  [IssueSeverity.MEDIUM]: { label: 'Medio', className: 'severity-medium', icon: '🟡' },
  [IssueSeverity.LOW]: { label: 'Bajo', className: 'severity-low', icon: '🔵' },
};

export function getSeverityLabel(severity: IssueSeverity): string {
  return severityConfig[severity]?.label || severity;
}

export const statusLabels: Record<ScanStatus, string> = {
  [ScanStatus.PENDING]: '⏳ Pendiente',
  [ScanStatus.RUNNING]: '🔄 Ejecutando',
  [ScanStatus.COMPLETED]: '✅ Completado',
  [ScanStatus.FAILED]: '❌ Fallido',
};

export function getStatusLabel(status: ScanStatus): string {
  return statusLabels[status] || status;
}
