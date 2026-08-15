import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class LazyLoadChecker implements IChecker {
  name = 'LazyLoadChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const f = facts ?? await collectPageFacts(page);
    const lazyImages = f.lazyImages;

    for (const img of lazyImages) {
      issues.push({
        type: IssueType.LAZY_LOAD,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Imagen lazy-load no se cargo despues del scroll: ${img.alt || img.dataSrc || img.src}`,
        metadata: { src: img.src, dataSrc: img.dataSrc, width: img.width, height: img.height, selector: img.src ? 'img[src="' + img.src.replace(/"/g, '\\"') + '"]' : 'img[loading="lazy"]' },
      });
    }

    const stuckSpinners = f.spinners;

    for (const spinner of stuckSpinners) {
      issues.push({
        type: IssueType.LAZY_LOAD,
        severity: IssueSeverity.HIGH,
        url,
        description: `Indicador de carga atascado (spinner/skeleton visible despues de espera): ${spinner.className || spinner.selector}`,
        metadata: { selector: spinner.selector, className: spinner.className },
      });
    }

    const placeholderImages = f.placeholderImages;

    for (const img of placeholderImages) {
      issues.push({
        type: IssueType.LAZY_LOAD,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Imagen muestra placeholder en vez de contenido real (${img.naturalWidth}px natural, ${img.displayWidth}px display)`,
        metadata: { src: img.src, naturalWidth: img.naturalWidth, displayWidth: img.displayWidth, selector: 'img[src="' + img.src.replace(/"/g, '\\"') + '"]' },
      });
    }

    return issues;
  }
}
