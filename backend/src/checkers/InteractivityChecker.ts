import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

export class InteractivityChecker implements IChecker {
  name = 'InteractivityChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const deadButtons: Array<{ tag: string; text: string; hasOnclick: boolean; ariaLabel: string }> = await page.evaluate(`(() => {
      var selectors = 'button:not([disabled]),a[role="button"],input[type="button"],input[type="submit"],[role="button"],[onclick]';
      var elements = Array.from(document.querySelectorAll(selectors));
      var results = [];
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        var style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        var tag = el.tagName.toLowerCase();
        var text = (el.textContent || '').trim().substring(0, 50);
        var ariaLabel = el.getAttribute('aria-label') || '';
        if (tag === 'a' && !el.href) {
          results.push({ tag: tag, text: text, hasOnclick: !!el.getAttribute('onclick'), ariaLabel: ariaLabel });
        }
      }
      return results.slice(0, 20);
    })()`);

    for (const btn of deadButtons) {
      issues.push({
        type: IssueType.INTERACTIVITY,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Enlace sin destino (href vacio): "${btn.text || btn.ariaLabel || '<sin texto>'}"`,
        metadata: { tag: btn.tag, text: btn.text, ariaLabel: btn.ariaLabel },
      });
    }

    const placeholderLinks: Array<{ text: string; href: string }> = await page.evaluate(`(() => {
      var links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .filter(function(a) {
          var href = a.getAttribute('href') || '';
          var rect = a.getBoundingClientRect();
          return (href === '#' || href === 'javascript:void(0)' || href === 'javascript:;') && rect.width > 0 && rect.height > 0;
        })
        .map(function(a) {
          return { text: (a.textContent || '').trim().substring(0, 50), href: a.getAttribute('href') || '' };
        })
        .slice(0, 15);
    })()`);

    for (const link of placeholderLinks) {
      issues.push({
        type: IssueType.INTERACTIVITY,
        severity: IssueSeverity.LOW,
        url,
        description: `Enlace con destino placeholder (${link.href}): "${link.text || '<sin texto>'}"`,
        metadata: { href: link.href, text: link.text },
      });
    }

    const pseudoDisabled: Array<{ text: string; opacity: string; cursor: string }> = await page.evaluate(`(() => {
      var buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      return buttons
        .filter(function(btn) {
          var style = window.getComputedStyle(btn);
          var rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          var looksDisabled = parseFloat(style.opacity) < 0.5 || style.cursor === 'not-allowed';
          return looksDisabled && !btn.disabled;
        })
        .map(function(btn) {
          var style = window.getComputedStyle(btn);
          return { text: (btn.textContent || '').trim().substring(0, 50), opacity: style.opacity, cursor: style.cursor };
        })
        .slice(0, 10);
    })()`);

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
