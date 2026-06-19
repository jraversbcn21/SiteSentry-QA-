import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

export class LazyLoadChecker implements IChecker {
  name = 'LazyLoadChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const lazyImages: Array<{ src: string; dataSrc: string; width: number; height: number; alt: string }> = await page.evaluate(`(() => {
      var imgs = Array.from(document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy]'));
      return imgs
        .map(function(img) {
          var rect = img.getBoundingClientRect();
          return {
            src: img.src || '',
            dataSrc: img.getAttribute('data-src') || img.getAttribute('data-lazy') || '',
            loaded: img.complete && img.naturalWidth > 0,
            inViewport: rect.top < window.innerHeight * 2,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            alt: img.alt || ''
          };
        })
        .filter(function(img) { return !img.loaded && img.inViewport && (img.width > 0 || img.height > 0); })
        .slice(0, 20);
    })()`);

    for (const img of lazyImages) {
      issues.push({
        type: IssueType.LAZY_LOAD,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Imagen lazy-load no se cargo despues del scroll: ${img.alt || img.dataSrc || img.src}`,
        metadata: { src: img.src, dataSrc: img.dataSrc, width: img.width, height: img.height, selector: img.src ? 'img[src="' + img.src.replace(/"/g, '\\"') + '"]' : 'img[loading="lazy"]' },
      });
    }

    const scrollIssues: { stuckSpinners: Array<{ selector: string; className: string }> } = await page.evaluate(`(() => {
      var spinnerSelectors = ['.spinner','.loading','[class*="spinner"]','[class*="loading"]','[class*="loader"]','[aria-busy="true"]','.skeleton','[class*="skeleton"]','[class*="placeholder"]'];
      var stuckSpinners = [];
      for (var s = 0; s < spinnerSelectors.length; s++) {
        try {
          var elements = document.querySelectorAll(spinnerSelectors[s]);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var rect = el.getBoundingClientRect();
            var style = window.getComputedStyle(el);
            var isVisible = rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
            if (isVisible) {
              stuckSpinners.push({
                selector: spinnerSelectors[s],
                className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 60) : ''
              });
            }
          }
        } catch(e) {}
      }
      return { stuckSpinners: stuckSpinners.slice(0, 5) };
    })()`);

    for (const spinner of scrollIssues.stuckSpinners) {
      issues.push({
        type: IssueType.LAZY_LOAD,
        severity: IssueSeverity.HIGH,
        url,
        description: `Indicador de carga atascado (spinner/skeleton visible despues de espera): ${spinner.className || spinner.selector}`,
        metadata: { selector: spinner.selector, className: spinner.className },
      });
    }

    const placeholderImages: Array<{ src: string; displayWidth: number; naturalWidth: number; alt: string }> = await page.evaluate(`(() => {
      var imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(function(img) {
          var rect = img.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) return false;
          return img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2 && rect.width > 50;
        })
        .map(function(img) {
          return { src: img.src, displayWidth: Math.round(img.getBoundingClientRect().width), naturalWidth: img.naturalWidth, alt: img.alt || '' };
        })
        .slice(0, 15);
    })()`);

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
