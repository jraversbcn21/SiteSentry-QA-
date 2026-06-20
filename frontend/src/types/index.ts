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
  CONSOLE_ERROR = 'CONSOLE_ERROR',
  PERFORMANCE = 'PERFORMANCE',
  ACCESSIBILITY = 'ACCESSIBILITY',
  FLOW_ERROR = 'FLOW_ERROR',
}

export enum ScanStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface Issue {
  id?: string;
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string | null;
  stepIndex?: number | null;
}

export interface ScanRequest {
  url: string;
  visualDiffThreshold?: number;
  flow?: { name: string; steps: FlowStep[] };
  flowId?: string;
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
  fullPageScreenshot?: string | null;
  visualDiffs: VisualDiff[];
  baselineInfo: BaselineInfo | null;
  flow?: FlowInfo;
  steps?: StepResult[];
  summary: {
    total: number;
    byType: Record<IssueType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}

export interface VisualDiff {
  id: string;
  diffType: 'full_page' | 'element';
  baselineScanId: string;
  baselineIssueId?: string;
  diffPercentage: number;
  diffImagePath: string;
  thresholdUsed: number;
  elementIdentifier?: string;
  issueId?: string;
}

export interface BaselineInfo {
  scanId: string;
  isManual: boolean;
  createdAt: string;
}

export interface FlowStep {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  ms?: number;
  key?: string;
}

export interface FlowInfo {
  name: string;
  steps: FlowStep[];
}

export interface FlowDefinition {
  id: string;
  name: string;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface StepResult {
  index: number;
  action: string;
  label: string;
  issues: Issue[];
  fullPageScreenshot: string | null;
  summary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
