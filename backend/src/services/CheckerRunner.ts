import { Page } from 'playwright';
import { IChecker, Issue } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';

export async function runCheckers(
  checkers: IChecker[],
  url: string,
  page: Page,
  networkEvents: NetworkEvent[],
  consoleErrors: ConsoleEvent[] = []
): Promise<Issue[]> {
  var allIssues: Issue[] = [];

  for (var i = 0; i < checkers.length; i++) {
    var checker = checkers[i];
    try {
      var issues = await checker.check(url, page, networkEvents, consoleErrors);
      allIssues.push(...issues);
      console.log('[ScanWorker] ' + checker.name + ': ' + issues.length + ' issues');
    } catch (error) {
      console.error('[ScanWorker] ' + checker.name + ' fallo:', error);
    }
  }

  return allIssues;
}
