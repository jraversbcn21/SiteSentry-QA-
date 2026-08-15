import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class ContentChecker implements IChecker {
  name = 'ContentChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const f = facts ?? await collectPageFacts(page);
    const emptyContainers = f.emptyContainers;

    for (const container of emptyContainers) {
      const identifier = container.id
        ? `#${container.id}`
        : container.className
          ? `.${container.className.split(' ')[0]}`
          : `<${container.tag}>`;
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Contenedor vacio que deberia tener contenido: ${identifier} (${container.height}px de alto)`,
        metadata: { tag: container.tag, className: container.className, id: container.id, height: container.height, selector: container.selector },
      });
    }

    const errorStates = f.errorStates;

    for (const error of errorStates) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Mensaje de error visible en pagina: "${error.text}"`,
        metadata: { selector: error.selector, text: error.text },
      });
    }

    const hiddenWithContent = f.mainContent;

    if (!hiddenWithContent.mainHasContent && hiddenWithContent.tag) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Contenedor principal practicamente vacio: <${hiddenWithContent.tag}> (posible fallo de renderizado)`,
        metadata: { tag: hiddenWithContent.tag, id: hiddenWithContent.id, className: hiddenWithContent.className, selector: hiddenWithContent.selector || hiddenWithContent.tag },
      });
    }

    return issues;
  }
}
