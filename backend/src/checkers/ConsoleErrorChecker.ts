import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';

const NOISE_PATTERNS = [
  'favicon.ico',
  '[Fast Refresh]',
  'webpack',
  'hot-update',
  '__webpack',
  'react-devtools',
  'extension://',
  'chrome-extension://',
  'moz-extension://',
];

const HIGH_PATTERNS = [
  'Uncaught',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'Cannot read',
  'is not defined',
  'is not a function',
  'CORS',
  'blocked by CORS',
  'Access-Control',
  'Failed to fetch',
  'NetworkError',
];

export class ConsoleErrorChecker implements IChecker {
  name = 'ConsoleErrorChecker';

  async check(
    url: string,
    _page: Page,
    _networkEvents: NetworkEvent[],
    consoleErrors: ConsoleEvent[] = []
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    const seen = new Set<string>();

    for (const error of consoleErrors.slice(0, 30)) {
      if (NOISE_PATTERNS.some((p) => error.text.includes(p))) continue;

      const key = error.text.substring(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);

      const isHigh = HIGH_PATTERNS.some((p) => error.text.includes(p));
      const severity = isHigh ? IssueSeverity.HIGH : IssueSeverity.MEDIUM;

      const description = this.buildDescription(error.text);

      issues.push({
        type: IssueType.CONSOLE_ERROR,
        severity,
        url,
        description,
        metadata: {
          message: error.text.substring(0, 500),
          source: error.location || null,
          consoleType: error.type,
        },
      });
    }

    return issues;
  }

  private buildDescription(text: string): string {
    const short = text.substring(0, 200);
    if (text.includes('CORS') || text.includes('Access-Control')) {
      return `Error CORS en consola: ${short}`;
    }
    if (text.includes('Uncaught') || text.includes('TypeError') || text.includes('ReferenceError')) {
      return `Error JavaScript no capturado: ${short}`;
    }
    if (text.includes('Failed to load') || text.includes('net::ERR')) {
      return `Fallo de red detectado en consola: ${short}`;
    }
    return `Error en consola del navegador: ${short}`;
  }
}
