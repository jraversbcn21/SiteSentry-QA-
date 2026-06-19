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
}

export enum IssueSeverity {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string;
}

export interface ScanConfig {
  timeout: number;
}

export interface IChecker {
  name: string;
  check(url: string, page: Page, networkEvents: NetworkEvent[], consoleErrors?: ConsoleEvent[]): Promise<Issue[]>;
}
