import { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { IChecker, Issue, IssueType, IssueSeverity } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';
import { mapBy } from './severity';

var impactToSeverity = mapBy<string>({
  critical: IssueSeverity.HIGH,
  serious: IssueSeverity.HIGH,
  moderate: IssueSeverity.MEDIUM,
  minor: IssueSeverity.LOW,
}, IssueSeverity.MEDIUM);

const WCAG_DESCRIPTIONS: Record<string, string> = {
  'image-alt': 'Imagen sin texto alternativo (alt)',
  'label': 'Campo de formulario sin etiqueta accesible',
  'button-name': 'Botón sin nombre accesible',
  'link-name': 'Enlace sin texto descriptivo',
  'color-contrast': 'Contraste de color insuficiente',
  'heading-order': 'Estructura de encabezados incorrecta',
  'landmark-one-main': 'Página sin landmark principal (<main>)',
  'region': 'Contenido fuera de landmark accesible',
  'html-has-lang': 'Elemento <html> sin atributo lang',
  'document-title': 'Página sin título (<title>)',
  'frame-title': 'iframe sin título accesible',
  'list': 'Estructura de lista inválida',
  'listitem': 'Elemento <li> fuera de lista',
  'aria-required-attr': 'Atributo ARIA requerido faltante',
  'aria-valid-attr': 'Atributo ARIA inválido',
  'aria-valid-attr-value': 'Valor de atributo ARIA inválido',
};

export class AccessibilityChecker implements IChecker {
  name = 'AccessibilityChecker';

  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    for (const violation of results.violations.slice(0, 30)) {
      const severity = impactToSeverity(violation.impact);
      const label = WCAG_DESCRIPTIONS[violation.id] ?? violation.description;

      const affectedCount = violation.nodes.length;
      const exampleSelectors = violation.nodes
        .slice(0, 3)
        .map((n) => n.target?.join(' > ') ?? '')
        .filter(Boolean);

      const exampleHtml = violation.nodes[0]?.html?.substring(0, 150) ?? '';

      issues.push({
        type: IssueType.ACCESSIBILITY,
        severity,
        url,
        description: `[${violation.id}] ${label} — ${affectedCount} elemento${affectedCount > 1 ? 's' : ''} afectado${affectedCount > 1 ? 's' : ''}`,
        metadata: {
          ruleId: violation.id,
          impact: violation.impact,
          wcagTags: violation.tags.filter((t) => t.startsWith('wcag')),
          affectedCount,
          exampleSelectors,
          exampleHtml,
          helpUrl: violation.helpUrl,
        },
      });
    }

    return issues;
  }
}
