import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';
import { visibilityCheckSnippet } from './domHelpers';

export class FormModalChecker implements IChecker {
  name = 'FormModalChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const formIssues: Array<{ id: string; action: string; inputCount: number; issue: string }> = await page.evaluate(`(() => {
      var forms = Array.from(document.querySelectorAll('form'));
      var results = [];
      for (var i = 0; i < forms.length; i++) {
        var form = forms[i];
        var rect = form.getBoundingClientRect();
        if (rect.height === 0) continue;
        var action = form.getAttribute('action') || '';
        var hasSubmit = form.querySelector('button[type="submit"], input[type="submit"]') !== null;
        var inputs = form.querySelectorAll('input, textarea, select');
        if (inputs.length > 0 && !hasSubmit) {
          results.push({ id: form.id || '', action: action, inputCount: inputs.length, issue: 'no_submit' });
        }
        if (action === '#' || action === '') {
          var hasHandler = form.getAttribute('onsubmit') !== null;
          if (!hasHandler) {
            results.push({ id: form.id || '', action: action, inputCount: inputs.length, issue: 'no_action' });
          }
        }
      }
      return results.slice(0, 10);
    })()`);

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

    const modalIssues: Array<{ selector: string; hasCloseButton: boolean; text: string }> = await page.evaluate(`(() => {
      var modalSelectors = ['[role="dialog"]','.modal','[class*="modal"]','[class*="dialog"]','[class*="popup"]','[class*="overlay"]','dialog'];
      var results = [];
      for (var s = 0; s < modalSelectors.length; s++) {
        try {
          var elements = document.querySelectorAll(modalSelectors[s]);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var style = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect();
            var isVisible = ${visibilityCheckSnippet()} && rect.height > 100;
            if (!isVisible) continue;
            var hasClose = el.querySelector('button[class*="close"], [aria-label="close"], [aria-label="Close"], .close, [class*="dismiss"]') !== null;
            var coversPage = rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3;
            if (coversPage) {
              results.push({ selector: modalSelectors[s], hasCloseButton: hasClose, text: (el.textContent || '').trim().substring(0, 80) });
            }
          }
        } catch(e) {}
      }
      return results.slice(0, 5);
    })()`);

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

    const blockers: { found: boolean; selector?: string; height?: number; position?: string } = await page.evaluate(`(() => {
      var blockerSelectors = ['[class*="cookie"]','[class*="consent"]','[class*="gdpr"]','[id*="cookie"]','[id*="consent"]'];
      for (var s = 0; s < blockerSelectors.length; s++) {
        try {
          var elements = document.querySelectorAll(blockerSelectors[s]);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var style = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect();
            var isVisible = ${visibilityCheckSnippet({ includeOpacity: false })} && rect.height > 50;
            var isFixed = style.position === 'fixed' || style.position === 'sticky';
            var hasHighZ = parseInt(style.zIndex, 10) > 100;
            if (isVisible && (isFixed || hasHighZ)) {
              return { found: true, selector: blockerSelectors[s], height: Math.round(rect.height), position: style.position };
            }
          }
        } catch(e) {}
      }
      return { found: false };
    })()`);

    if (blockers.found) {
      issues.push({
        type: IssueType.FORM_MODAL,
        severity: IssueSeverity.LOW,
        url,
        description: `Banner de cookies/consent superpuesto detectado - puede bloquear interaccion`,
        metadata: blockers,
      });
    }

    return issues;
  }
}
