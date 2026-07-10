import { Router, Request, Response } from 'express';
import { getDb } from '../../database/db';
import path from 'path';
import fs from 'fs';

export const reportsRoutes = Router();

// GET /api/reports - Listar todos los reportes con paginacion
reportsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
    var parsedOffset = parseInt((req.query.offset as string) || '0', 10);
    const offset = Number.isNaN(parsedOffset) ? 0 : parsedOffset;
    const db = getDb();

    const scans = db.prepare(
      'SELECT id, url, status, created_at, completed_at FROM scans ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Array<{
      id: string;
      url: string;
      status: string;
      created_at: string;
      completed_at: string | null;
    }>;

    return res.json(scans.map((s) => ({
      id: s.id,
      url: s.url,
      status: s.status,
      createdAt: s.created_at,
      completedAt: s.completed_at,
    })));
  } catch (error) {
    console.error('Error obteniendo reportes:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reports/:id - Obtener reporte especifico con issues
reportsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const scan = db.prepare('SELECT * FROM scans WHERE id = ?').get(id) as {
      id: string;
      url: string;
      status: string;
      config: string;
      created_at: string;
      completed_at: string | null;
    } | undefined;

    if (!scan) {
      return res.status(404).json({ error: 'Reporte no encontrado' });
    }

    const issues = db.prepare(
      'SELECT * FROM issues WHERE scan_id = ? ORDER BY CASE severity ' +
      "WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, type ASC"
    ).all(id) as Array<{
      id: string;
      scan_id: string;
      type: string;
      severity: string;
      url: string;
      source_url: string | null;
      description: string;
      metadata: string | null;
      screenshot_path: string | null;
      created_at: string;
    }>;

    const parsedIssues = issues.map((i) => ({
      id: i.id,
      scanId: i.scan_id,
      type: i.type,
      severity: i.severity,
      url: i.url,
      sourceUrl: i.source_url,
      description: i.description,
      metadata: i.metadata ? JSON.parse(i.metadata) : null,
      screenshot_path: i.screenshot_path || null,
      stepIndex: (i as any).step_index ?? null,
      createdAt: i.created_at,
    }));

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const issue of parsedIssues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    // Build per-step results if flow scan
    var flow: { name: string; steps: Array<{ index: number; action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }> } | undefined;
    var steps: Array<{
      index: number;
      action: string;
      label: string;
      issues: any[];
      fullPageScreenshot: string | null;
      summary: { total: number; byType: Record<string, number>; bySeverity: Record<string, number> };
    }> | undefined;

    function buildStepLabel(step: { action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }): string {
      if (step.action === 'navigate' && step.url) return 'Navegar a ' + step.url.replace(/^https?:\/\//, '').substring(0, 40);
      if (step.action === 'click' && step.selector) return 'Click en ' + step.selector;
      if (step.action === 'type' && step.selector) return 'Escribir en ' + step.selector;
      if (step.action === 'wait' && step.ms) return 'Esperar ' + step.ms + 'ms';
      if (step.action === 'select' && step.selector) return 'Seleccionar en ' + step.selector;
      if (step.action === 'hover' && step.selector) return 'Hover en ' + step.selector;
      if (step.action === 'press' && step.key) return 'Presionar ' + step.key;
      if (step.action === 'checkpoint') return 'Checkpoint';
      return 'Paso ' + step.action;
    }

    try {
      var configObj = JSON.parse(scan.config);
      if (configObj.flow && configObj.flow.steps) {
        var flowSteps = configObj.flow.steps as Array<{ action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }>;
        flow = { name: configObj.flow.name, steps: flowSteps.map(function(s: any, i: number) { return { index: i, ...s }; }) };

        steps = flowSteps.map(function(step: { action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }, index: number) {
          var stepIssues = parsedIssues.filter(function(issue: any) { return issue.stepIndex === index; });
          var stepByType: Record<string, number> = {};
          var stepBySeverity: Record<string, number> = {};
          for (var si = 0; si < stepIssues.length; si++) {
            var sIssue = stepIssues[si];
            stepByType[sIssue.type] = (stepByType[sIssue.type] || 0) + 1;
            stepBySeverity[sIssue.severity] = (stepBySeverity[sIssue.severity] || 0) + 1;
          }

          var label = buildStepLabel(step);

          var stepScreenshotPath = path.join(process.cwd(), 'data', 'screenshots', scan.id, 'step-' + index + '-full.png');
          var stepScreenshot = fs.existsSync(stepScreenshotPath) ? scan.id + '/step-' + index + '-full.png' : null;

          return {
            index: index,
            action: step.action,
            label: label,
            issues: stepIssues,
            fullPageScreenshot: stepScreenshot,
            summary: { total: stepIssues.length, byType: stepByType, bySeverity: stepBySeverity },
          };
        });
      }
    } catch {}

    const fullPagePath = path.join(process.cwd(), 'data', 'screenshots', scan.id, 'full.png');
    const fullPageScreenshot = fs.existsSync(fullPagePath) ? `${scan.id}/full.png` : null;

    // Visual diffs
    const visualDiffs = db.prepare(
      'SELECT * FROM visual_diffs WHERE scan_id = ? ORDER BY diff_type, created_at'
    ).all(id) as Array<{
      id: string;
      scan_id: string;
      baseline_scan_id: string;
      diff_type: string;
      issue_id: string | null;
      baseline_issue_id: string | null;
      element_identifier: string | null;
      diff_percentage: number;
      diff_image_path: string | null;
      threshold_used: number;
      created_at: string;
    }>;

    const parsedVisualDiffs = visualDiffs.map((d) => ({
      id: d.id,
      diffType: d.diff_type,
      baselineScanId: d.baseline_scan_id,
      baselineIssueId: d.baseline_issue_id || undefined,
      diffPercentage: d.diff_percentage,
      diffImagePath: d.diff_image_path,
      thresholdUsed: d.threshold_used,
      elementIdentifier: d.element_identifier || undefined,
      issueId: d.issue_id || undefined,
    }));

    // Baseline info
    let baselineInfo: { scanId: string; isManual: boolean; createdAt: string } | null = null;
    if (visualDiffs.length > 0) {
      const baselineScan = db.prepare(
        'SELECT id, is_baseline, created_at FROM scans WHERE id = ?'
      ).get(visualDiffs[0].baseline_scan_id) as {
        id: string;
        is_baseline: number;
        created_at: string;
      } | undefined;

      if (baselineScan) {
        baselineInfo = {
          scanId: baselineScan.id,
          isManual: baselineScan.is_baseline === 1,
          createdAt: baselineScan.created_at,
        };
      }
    }

    return res.json({
      id: scan.id,
      url: scan.url,
      status: scan.status,
      createdAt: scan.created_at,
      completedAt: scan.completed_at,
      issues: parsedIssues,
      fullPageScreenshot,
      flow,
      steps,
      visualDiffs: parsedVisualDiffs,
      baselineInfo,
      summary: {
        total: parsedIssues.length,
        byType,
        bySeverity,
      },
    });
  } catch (error) {
    console.error('Error obteniendo reporte:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
