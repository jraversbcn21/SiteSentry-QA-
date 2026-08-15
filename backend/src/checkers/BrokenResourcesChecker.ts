import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts } from './pageFacts';

export class BrokenResourcesChecker implements IChecker {
  name = 'BrokenResourcesChecker';

  async check(url: string, page: Page, networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
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
          metadata: { resourceType: event.resourceType, error: event.failureText, timing: event.timing, mimeType: event.mimeType || undefined, size: event.size || undefined },
        });
      } else if (event.status !== null && event.status >= 400) {
        issues.push({
          type: IssueType.BROKEN_RESOURCE,
          severity: event.resourceType === 'script' ? IssueSeverity.HIGH : IssueSeverity.MEDIUM,
          url: event.url,
          sourceUrl: url,
          description: `${this.resourceLabel(event.resourceType)} devuelve error ${event.status}`,
          metadata: { resourceType: event.resourceType, statusCode: event.status, timing: event.timing, mimeType: event.mimeType || undefined, size: event.size || undefined },
        });
      }
    }

    const f = facts ?? await collectPageFacts(page);
    const brokenImages = f.brokenImages;

    for (const img of brokenImages) {
      const alreadyReported = issues.some((i) => i.url === img.src);
      if (alreadyReported) continue;
      const imgEvent = networkEvents.find((e) => e.url === img.src);
      issues.push({
        type: IssueType.BROKEN_RESOURCE,
        severity: IssueSeverity.MEDIUM,
        url: img.src,
        sourceUrl: url,
        description: `Imagen no renderizada: ${img.alt || img.src.substring(img.src.lastIndexOf('/') + 1)}`,
        metadata: {
          resourceType: 'image',
          alt: img.alt,
          width: img.width,
          height: img.height,
          selector: 'img[src="' + img.src.replace(/"/g, '\\"') + '"]',
          statusCode: imgEvent?.status ?? null,
          timing: imgEvent?.timing,
          mimeType: imgEvent?.mimeType || undefined,
          size: imgEvent?.size || undefined,
        },
      });
    }

    const brokenBgImages = f.backgroundImageUrls;

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
          metadata: {
            resourceType: 'background-image',
            statusCode: event.status,
            error: event.failureText || undefined,
            timing: event.timing,
            mimeType: event.mimeType || undefined,
            size: event.size || undefined,
          },
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
