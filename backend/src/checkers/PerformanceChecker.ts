import { Page } from 'playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { collectPageFacts, PageFacts, PerformanceFacts } from './pageFacts';

export class PerformanceChecker implements IChecker {
  name = 'PerformanceChecker';

  async check(url: string, page: Page, networkEvents: NetworkEvent[], _consoleErrors?: ConsoleEvent[], facts?: PageFacts): Promise<Issue[]> {
    const issues: Issue[] = [];

    const f = facts ?? await collectPageFacts(page);
    const metrics: PerformanceFacts = f.performance;

    if (metrics.ttfb > 2000) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.HIGH,
        url,
        description: `TTFB muy alto: el servidor tardó ${metrics.ttfb}ms en responder (umbral: 2000ms)`,
        metadata: { metric: 'ttfb', valueMs: metrics.ttfb, thresholdMs: 2000 },
      });
    } else if (metrics.ttfb > 800) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `TTFB elevado: el servidor tardó ${metrics.ttfb}ms en responder (umbral recomendado: 800ms)`,
        metadata: { metric: 'ttfb', valueMs: metrics.ttfb, thresholdMs: 800 },
      });
    }

    if (metrics.domContentLoaded > 0) {
      if (metrics.domContentLoaded > 6000) {
        issues.push({
          type: IssueType.PERFORMANCE,
          severity: IssueSeverity.HIGH,
          url,
          description: `DOMContentLoaded muy lento: ${metrics.domContentLoaded}ms (umbral: 6000ms) — posibles scripts bloqueantes`,
          metadata: { metric: 'domContentLoaded', valueMs: metrics.domContentLoaded, thresholdMs: 6000 },
        });
      } else if (metrics.domContentLoaded > 3000) {
        issues.push({
          type: IssueType.PERFORMANCE,
          severity: IssueSeverity.MEDIUM,
          url,
          description: `DOMContentLoaded lento: ${metrics.domContentLoaded}ms (umbral recomendado: 3000ms)`,
          metadata: { metric: 'domContentLoaded', valueMs: metrics.domContentLoaded, thresholdMs: 3000 },
        });
      }
    }

    if (metrics.fullLoad > 0) {
      if (metrics.fullLoad > 12000) {
        issues.push({
          type: IssueType.PERFORMANCE,
          severity: IssueSeverity.HIGH,
          url,
          description: `Carga completa de página muy lenta: ${(metrics.fullLoad / 1000).toFixed(1)}s (umbral: 12s)`,
          metadata: { metric: 'fullLoad', valueMs: metrics.fullLoad, thresholdMs: 12000 },
        });
      } else if (metrics.fullLoad > 6000) {
        issues.push({
          type: IssueType.PERFORMANCE,
          severity: IssueSeverity.MEDIUM,
          url,
          description: `Carga completa de página lenta: ${(metrics.fullLoad / 1000).toFixed(1)}s (umbral recomendado: 6s)`,
          metadata: { metric: 'fullLoad', valueMs: metrics.fullLoad, thresholdMs: 6000 },
        });
      }
    }

    if (metrics.domNodes > 4000) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `DOM excesivamente grande: ${metrics.domNodes} nodos (umbral: 4000) — puede causar lentitud en scroll e interacciones`,
        metadata: { metric: 'domNodes', value: metrics.domNodes, threshold: 4000 },
      });
    } else if (metrics.domNodes > 2500) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.LOW,
        url,
        description: `DOM grande: ${metrics.domNodes} nodos (umbral recomendado: 2500)`,
        metadata: { metric: 'domNodes', value: metrics.domNodes, threshold: 2500 },
      });
    }

    if (metrics.resourceCount > 200) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.MEDIUM,
        url,
        description: `Número excesivo de recursos: ${metrics.resourceCount} peticiones de red (umbral: 200) — considerar bundling/lazy loading`,
        metadata: { metric: 'resourceCount', value: metrics.resourceCount, threshold: 200, totalTransferKB: metrics.totalTransferKB },
      });
    } else if (metrics.resourceCount > 100) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.LOW,
        url,
        description: `Muchos recursos cargados: ${metrics.resourceCount} peticiones de red (${metrics.totalTransferKB}KB transferidos)`,
        metadata: { metric: 'resourceCount', value: metrics.resourceCount, threshold: 100, totalTransferKB: metrics.totalTransferKB },
      });
    }

    const slowNetworkResources = networkEvents.filter(
      (e) => !e.failed && e.timing > 5000 && ['script', 'stylesheet', 'font'].includes(e.resourceType)
    );

    for (const resource of slowNetworkResources.slice(0, 5)) {
      issues.push({
        type: IssueType.PERFORMANCE,
        severity: IssueSeverity.MEDIUM,
        url: resource.url,
        sourceUrl: url,
        description: `Recurso bloqueante lento (${resource.resourceType}): ${(resource.timing / 1000).toFixed(1)}s de carga`,
        metadata: { metric: 'slowResource', resourceType: resource.resourceType, timingMs: resource.timing },
      });
    }

    return issues;
  }
}
