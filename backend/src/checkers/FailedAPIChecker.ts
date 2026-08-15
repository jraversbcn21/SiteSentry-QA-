import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class FailedAPIChecker implements IChecker {
  name = 'FailedAPIChecker';

  async check(url: string, page: Page, networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const staticTypes = ['image', 'stylesheet', 'script', 'font', 'media', 'manifest', 'other'];

    for (const event of networkEvents) {
      const isApiCall =
        event.resourceType === 'xhr' ||
        event.resourceType === 'fetch' ||
        (!staticTypes.includes(event.resourceType) && event.mimeType.includes('json'));

      if (!isApiCall) continue;

      if (event.failed) {
        issues.push({
          type: IssueType.FAILED_API,
          severity: IssueSeverity.HIGH,
          url: event.url,
          sourceUrl: url,
          description: `Llamada API fallo: ${event.method} ${this.truncateUrl(event.url)} - ${event.failureText}`,
          metadata: { method: event.method, error: event.failureText, timing: event.timing },
        });
      } else if (event.status !== null && event.status >= 400) {
        issues.push({
          type: IssueType.FAILED_API,
          severity: event.status >= 500 ? IssueSeverity.HIGH : IssueSeverity.MEDIUM,
          url: event.url,
          sourceUrl: url,
          description: `API responde ${event.status}: ${event.method} ${this.truncateUrl(event.url)}`,
          metadata: { method: event.method, statusCode: event.status, statusText: event.statusText, timing: event.timing },
        });
      } else if (event.status !== null && event.timing > 10000) {
        issues.push({
          type: IssueType.FAILED_API,
          severity: IssueSeverity.MEDIUM,
          url: event.url,
          sourceUrl: url,
          description: `API extremadamente lenta (${Math.round(event.timing / 1000)}s): ${event.method} ${this.truncateUrl(event.url)}`,
          metadata: { method: event.method, statusCode: event.status, timing: event.timing },
        });
      }
    }

    const f = facts ?? await collectPageFacts(page);
    const corsErrors = f.corsCandidates;

    for (const entry of corsErrors) {
      const netEvent = networkEvents.find((e) => e.url === entry.url);
      if (netEvent && netEvent.failed && netEvent.failureText?.includes('net::ERR_FAILED')) {
        const alreadyReported = issues.some((i) => i.url === entry.url);
        if (!alreadyReported) {
          issues.push({
            type: IssueType.FAILED_API,
            severity: IssueSeverity.HIGH,
            url: entry.url,
            sourceUrl: url,
            description: `Posible error CORS: ${this.truncateUrl(entry.url)} bloqueado`,
            metadata: { possibleCORS: true, duration: entry.duration },
          });
        }
      }
    }

    return issues;
  }

  private truncateUrl(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      const path = parsed.pathname + parsed.search;
      return path.length > 80 ? path.substring(0, 77) + '...' : path;
    } catch {
      return urlStr.length > 80 ? urlStr.substring(0, 77) + '...' : urlStr;
    }
  }
}
