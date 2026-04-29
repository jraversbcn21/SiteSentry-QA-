export enum IssueSeverity {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum IssueType {
  BROKEN_RESOURCE = 'BROKEN_RESOURCE',
  FAILED_API = 'FAILED_API',
  INTERACTIVITY = 'INTERACTIVITY',
  EMPTY_CONTENT = 'EMPTY_CONTENT',
  LAZY_LOAD = 'LAZY_LOAD',
  FORM_MODAL = 'FORM_MODAL',
}

export enum ScanStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface ScanRequest {
  url: string;
  config?: {
    timeout?: number;
  };
}

export interface ScanResponse {
  id: string;
  status: ScanStatus;
  url: string;
  createdAt: string;
}

export interface ScanStatusResponse {
  id: string;
  status: ScanStatus;
  url: string;
  progress?: {
    phase: string;
  };
  createdAt: string;
  completedAt?: string;
}

export interface ReportResponse {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  completedAt?: string;
  issues: Issue[];
  summary: {
    total: number;
    byType: Record<IssueType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}
