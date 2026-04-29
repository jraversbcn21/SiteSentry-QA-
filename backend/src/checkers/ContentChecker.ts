import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

export class ContentChecker implements IChecker {
  name = 'ContentChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const emptyContainers: Array<{ selector: string; tag: string; className: string; id: string; height: number }> = await page.evaluate(`(() => {
      var selectors = ['main','[role="main"]','.products','.product-list','.product-grid','.items','.results','.content','.listing','.grid','.cards','.feed','[data-testid]','ul.list','ol.list','section > div'];
      var results = [];
      for (var s = 0; s < selectors.length; s++) {
        var elements = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          var childCount = el.children.length;
          var textLength = (el.textContent || '').trim().length;
          if (rect.height > 50 && rect.width > 100 && childCount === 0 && textLength === 0) {
            results.push({
              selector: selectors[s],
              tag: el.tagName.toLowerCase(),
              className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 60) : '',
              id: el.id || '',
              height: Math.round(rect.height)
            });
          }
        }
      }
      return results.slice(0, 15);
    })()`);

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
        metadata: { tag: container.tag, className: container.className, id: container.id, height: container.height },
      });
    }

    const errorStates: Array<{ text: string; selector: string }> = await page.evaluate(`(() => {
      var errorSelectors = ['.error','.error-message','[class*="error"]','[class*="Error"]','.alert-danger','.alert-error','[role="alert"]','.no-results','.empty-state','.not-found'];
      var results = [];
      for (var s = 0; s < errorSelectors.length; s++) {
        try {
          var elements = document.querySelectorAll(errorSelectors[s]);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var style = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect();
            var isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && rect.height > 0;
            if (isVisible) {
              var text = (el.textContent || '').trim().substring(0, 100);
              if (text.length > 0) results.push({ text: text, selector: errorSelectors[s] });
            }
          }
        } catch(e) {}
      }
      return results.slice(0, 10);
    })()`);

    for (const error of errorStates) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Mensaje de error visible en pagina: "${error.text}"`,
        metadata: { selector: error.selector, text: error.text },
      });
    }

    const hiddenWithContent: { mainHasContent: boolean; tag?: string; id?: string; className?: string } = await page.evaluate(`(() => {
      var containers = document.querySelectorAll('main, [role="main"], .content, #content, #app, #root');
      if (containers.length === 0) return { mainHasContent: true };
      for (var i = 0; i < containers.length; i++) {
        var text = (containers[i].textContent || '').trim();
        if (text.length < 10) {
          return {
            mainHasContent: false,
            tag: containers[i].tagName.toLowerCase(),
            id: containers[i].id || '',
            className: (containers[i].className && typeof containers[i].className === 'string') ? containers[i].className.substring(0, 40) : ''
          };
        }
      }
      return { mainHasContent: true };
    })()`);

    if (!hiddenWithContent.mainHasContent && hiddenWithContent.tag) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Contenedor principal practicamente vacio: <${hiddenWithContent.tag}> (posible fallo de renderizado)`,
        metadata: { tag: hiddenWithContent.tag, id: hiddenWithContent.id, className: hiddenWithContent.className },
      });
    }

    return issues;
  }
}
