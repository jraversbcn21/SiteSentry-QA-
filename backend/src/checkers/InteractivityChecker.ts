import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class InteractivityChecker implements IChecker {
  name = 'InteractivityChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const f = facts ?? await collectPageFacts(page);
    const deadButtons = f.deadButtons;

    for (const btn of deadButtons) {
      issues.push({
        type: IssueType.INTERACTIVITY,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Enlace sin destino (href vacio): "${btn.text || btn.ariaLabel || '<sin texto>'}"`,
        metadata: { tag: btn.tag, text: btn.text, ariaLabel: btn.ariaLabel },
      });
    }

    const placeholderLinks = f.placeholderLinks;

    for (const link of placeholderLinks) {
      issues.push({
        type: IssueType.INTERACTIVITY,
        severity: IssueSeverity.LOW,
        url,
        description: `Enlace con destino placeholder (${link.href}): "${link.text || '<sin texto>'}"`,
        metadata: { href: link.href, text: link.text },
      });
    }

    const pseudoDisabled = f.pseudoDisabledButtons;

    for (const btn of pseudoDisabled) {
      issues.push({
        type: IssueType.INTERACTIVITY,
        severity: IssueSeverity.LOW,
        url,
        description: `Boton parece deshabilitado pero no tiene atributo disabled: "${btn.text}"`,
        metadata: { opacity: btn.opacity, cursor: btn.cursor },
      });
    }

    return issues;
  }
}
