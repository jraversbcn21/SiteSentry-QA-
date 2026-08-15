import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class FormModalChecker implements IChecker {
  name = 'FormModalChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const f = facts ?? await collectPageFacts(page);
    const formIssues = f.formIssues;

    for (const form of formIssues) {
      const formId = form.id ? ` (id: ${form.id})` : '';
      if (form.issue === 'no_submit') {
        issues.push({
          type: IssueType.FORM_MODAL,
          severity: IssueSeverity.MEDIUM,
          url,
          description: `Formulario sin boton de envio${formId} (${form.inputCount} campos)`,
          metadata: { formId: form.id, inputCount: form.inputCount },
        });
      } else if (form.issue === 'no_action') {
        issues.push({
          type: IssueType.FORM_MODAL,
          severity: IssueSeverity.LOW,
          url,
          description: `Formulario sin action definido${formId} - puede no enviar datos`,
          metadata: { formId: form.id, action: form.action },
        });
      }
    }

    const modalIssues = f.modals;

    for (const modal of modalIssues) {
      if (!modal.hasCloseButton) {
        issues.push({
          type: IssueType.FORM_MODAL,
          severity: IssueSeverity.MEDIUM,
          url,
          description: `Modal/dialogo visible sin boton de cierre: "${modal.text.substring(0, 40)}..."`,
          metadata: { selector: modal.selector, hasCloseButton: false },
        });
      }
    }

    const blockers = f.cookieBlocker;

    if (blockers.found) {
      issues.push({
        type: IssueType.FORM_MODAL,
        severity: IssueSeverity.LOW,
        url,
        description: `Banner de cookies/consent superpuesto detectado - puede bloquear interaccion`,
        metadata: { ...blockers },
      });
    }

    return issues;
  }
}
