import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

export class BrokenResourcesChecker implements IChecker {
  name = 'BrokenResourcesChecker';

  async check(url: string, page: Page, networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const resourceTypes = ['image', 'stylesheet', 'script', 'font', 'media'];

    for (const event of networkEvents) {
      if (!resourceTypes.includes(event.resourceType)) continue;

      if (event.failed) {
        issues.push({
          type: IssueType.BROKEN_RESOURCE,
          severity: event.resourceType === 'script' ? IssueSeverity.HIGH : IssueSeverity.MEDIUM,
          url: event.url,
          sourceUrl: url,
          description: `${this.resourceLabel(event.resourceType)} no carga: ${event.failureText}`,
          metadata: { resourceType: event.resourceType, error: event.failureText },
        });
      } else if (event.status !== null && event.status >= 400) {
        issues.push({
          type: IssueType.BROKEN_RESOURCE,
          severity: event.resourceType === 'script' ? IssueSeverity.HIGH : IssueSeverity.MEDIUM,
          url: event.url,
          sourceUrl: url,
          description: `${this.resourceLabel(event.resourceType)} devuelve error ${event.status}`,
          metadata: { resourceType: event.resourceType, statusCode: event.status },
        });
      }
    }

    const brokenImages: Array<{ src: string; alt: string; width: number; height: number }> = await page.evaluate(`(() => {
      var imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(function(img) {
          if (!img.src || img.src.startsWith('data:')) return false;
          return !img.complete || img.naturalWidth === 0;
        })
        .map(function(img) {
          return { src: img.src, alt: img.alt || '', width: img.width, height: img.height };
        })
        .slice(0, 30);
    })()`);

    for (const img of brokenImages) {
      const alreadyReported = issues.some((i) => i.url === img.src);
      if (alreadyReported) continue;
      issues.push({
        type: IssueType.BROKEN_RESOURCE,
        severity: IssueSeverity.MEDIUM,
        url: img.src,
        sourceUrl: url,
        description: `Imagen no renderizada: ${img.alt || img.src.substring(img.src.lastIndexOf('/') + 1)}`,
        metadata: { alt: img.alt, width: img.width, height: img.height },
      });
    }

    const brokenBgImages: string[] = await page.evaluate(`(() => {
      var elements = Array.from(document.querySelectorAll('*'));
      var results = [];
      for (var i = 0; i < elements.length; i++) {
        var bg = window.getComputedStyle(elements[i]).backgroundImage;
        if (bg && bg !== 'none' && bg.startsWith('url(')) {
          var match = bg.match(/url\\(["']?(.+?)["']?\\)/);
          if (match && match[1] && !match[1].startsWith('data:')) {
            results.push(match[1]);
          }
        }
        if (results.length >= 50) break;
      }
      return Array.from(new Set(results));
    })()`);

    for (const bgUrl of brokenBgImages) {
      const event = networkEvents.find(
        (e) => e.url === bgUrl && (e.failed || (e.status !== null && e.status >= 400))
      );
      if (event && !issues.some((i) => i.url === bgUrl)) {
        issues.push({
          type: IssueType.BROKEN_RESOURCE,
          severity: IssueSeverity.MEDIUM,
          url: bgUrl,
          sourceUrl: url,
          description: `Imagen de fondo no carga: ${event.failed ? event.failureText : `HTTP ${event.status}`}`,
          metadata: { resourceType: 'background-image' },
        });
      }
    }

    return issues;
  }

  private resourceLabel(type: string): string {
    const labels: Record<string, string> = {
      image: 'Imagen',
      stylesheet: 'Hoja de estilos CSS',
      script: 'Script JavaScript',
      font: 'Fuente',
      media: 'Recurso multimedia',
    };
    return labels[type] || 'Recurso';
  }
}
