import type { Page } from 'playwright';
import type { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';

export enum ScanStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
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

export enum IssueSeverity {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export interface Issue {
  id?: string;
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string;
  stepIndex?: number;
}

export interface ScanConfig {
  timeout: number;
  visualDiffThreshold?: number;
  flow?: FlowInfo;
}

export interface IChecker {
  name: string;
  check(url: string, page: Page, networkEvents: NetworkEvent[], consoleErrors?: ConsoleEvent[]): Promise<Issue[]>;
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

export interface VisualDiff {
  id: string;
  diffType: 'full_page' | 'element';
  baselineScanId: string;
  diffPercentage: number;
  diffImagePath: string;
  thresholdUsed: number;
  elementIdentifier?: string;
  issueId?: string;
  baselineIssueId?: string;
}

export interface BaselineInfo {
  scanId: string;
  isManual: boolean;
  createdAt: string;
}

export interface ReportResponse {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  completedAt?: string;
  issues: Array<{
    id: string;
    scanId: string;
    type: IssueType;
    severity: IssueSeverity;
    url: string;
    sourceUrl: string | null;
    description: string;
    metadata: Record<string, unknown> | null;
    screenshot_path: string | null;
    createdAt: string;
  }>;
  fullPageScreenshot?: string | null;
  flow?: { name: string; steps: Array<{ index: number; action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }> };
  steps?: StepResult[];
  visualDiffs: VisualDiff[];
  baselineInfo: BaselineInfo | null;
  summary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
