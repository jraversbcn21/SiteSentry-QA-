import { Page } from 'playwright';
import { IChecker, Issue } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from '../checkers/pageFacts';

export async function runCheckers(
  checkers: IChecker[],
  url: string,
  page: Page,
  networkEvents: NetworkEvent[],
  consoleErrors: ConsoleEvent[] = []
): Promise<Issue[]> {
  var allIssues: Issue[] = [];

  // Shared single-pass DOM snapshot (T33/H9): one evaluate round-trip
  // consumed by all checkers instead of 16 per-checker round-trips.
  var facts: PageFacts | undefined;
  try {
    facts = await collectPageFacts(page);
  } catch (error) {
    console.error('[CheckerRunner] PageFacts pre-pass fallo, los checkers recolectaran por si solos:', error);
  }

  for (var i = 0; i < checkers.length; i++) {
    var checker = checkers[i];
    try {
      var issues = await checker.check(url, page, networkEvents, consoleErrors, facts);
      allIssues.push(...issues);
      console.log('[ScanWorker] ' + checker.name + ': ' + issues.length + ' issues');
    } catch (error) {
      console.error('[ScanWorker] ' + checker.name + ' fallo:', error);
    }
  }

  return allIssues;
}
