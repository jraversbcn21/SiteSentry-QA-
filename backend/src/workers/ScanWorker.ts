import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { getDb } from '../database/db';
import { ScanStatus, IssueType, IssueSeverity } from '../types';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import { checkers } from '../checkers';
import { validateUrl } from '../security/ssrf';
import { runVisualRegression } from '../services/VisualRegressionService';
import { runCheckers } from '../services/CheckerRunner';
import { captureFullPage, captureElementScreenshots, copyLastStepScreenshot } from '../services/ScreenshotService';
import { executeFlow } from '../services/FlowEngine';
import path from 'path';
import fs from 'fs';

interface JobData {
  scanId: string;
  url: string;
  config: { timeout?: number; flow?: import('../types').FlowInfo };
}

export async function processScanJob(job: { data: JobData; updateProgress?: (progress: object) => void }) {
  const { scanId, url, config } = job.data;
  let browser = null;
  const db = getDb();

  try {
    db.prepare('UPDATE scans SET status = ? WHERE id = ?').run(ScanStatus.RUNNING, scanId);

    console.log(`[ScanWorker] Analizando pagina: ${url} (scan ${scanId})`);

    try {
      await validateUrl(url);
    } catch (ssrfErr: any) {
      console.warn(`[ScanWorker] SSRF bloqueado para ${url}: ${ssrfErr.message}`);
      db.prepare('UPDATE scans SET status = ?, completed_at = ? WHERE id = ?').run(
        ScanStatus.FAILED,
        new Date().toISOString(),
        scanId
      );
      return;
    }

    if (job.updateProgress) {
      try { job.updateProgress({ phase: 'launching_browser' }); } catch {}
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-http2',
      ],
    });

    if (job.updateProgress) {
      try { job.updateProgress({ phase: 'loading_page' }); } catch {}
    }

    const analyzer = new PageAnalyzer(browser, config.timeout || 30000);
    const analysis = await analyzer.analyze(url);

    console.log(
      `[ScanWorker] Pagina cargada (${analysis.statusCode}). ` +
      `Red: ${analysis.networkEvents.length} peticiones, ${analysis.failedRequests.length} fallidas. ` +
      `Consola: ${analysis.consoleErrors.length} errores.`
    );

    var flowConfig = config.flow;
    var allIssues: import('../types').Issue[] = [];
    var currentPage = analysis.page;

    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      console.log('[ScanWorker] Ejecutando flujo interactivo: ' + flowConfig.name + ' (' + flowConfig.steps.length + ' pasos)');

      var screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
      try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}

      var flowResult = await executeFlow({
        scanId: scanId,
        steps: flowConfig.steps,
        url: url,
        currentPage: currentPage,
        analyzer: analyzer,
        checkers: checkers,
        initialNetworkEvents: analysis.networkEvents,
        initialConsoleErrors: analysis.consoleErrors,
        config: { timeout: config.timeout },
        updateProgress: job.updateProgress,
        screenshotDir: screenshotDir,
      });

      allIssues = flowResult.allIssues;
      currentPage = flowResult.currentPage;

      await analyzer.close(currentPage);
    } else {
      if (job.updateProgress) {
        try { job.updateProgress({ phase: 'running_checks' }); } catch {}
      }

      allIssues = await runCheckers(checkers, url, analysis.page, analysis.networkEvents, analysis.consoleErrors);

      for (var i = 0; i < allIssues.length; i++) {
        allIssues[i].id = randomUUID();
      }

      await captureFullPage(analysis.page, scanId);
      await captureElementScreenshots(analysis.page, scanId, allIssues);

      await analyzer.close(analysis.page);
    }

    if (job.updateProgress) {
      try { job.updateProgress({ phase: 'saving_results' }); } catch {}
    }

    if (allIssues.length > 0) {
      const insertIssue = db.prepare(`
        INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, step_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((issues: import('../types').Issue[]) => {
        for (const issue of issues) {
          insertIssue.run(
            issue.id,
            scanId,
            issue.type,
            issue.severity,
            issue.url,
            issue.sourceUrl || null,
            issue.description,
            issue.metadata ? JSON.stringify(issue.metadata) : null,
            issue.screenshot_path || null,
            issue.stepIndex ?? null,
            new Date().toISOString()
          );
        }
      });

      insertMany(allIssues);
    }

    // Copiar ultimo step full-page como full.png para regresion visual
    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      copyLastStepScreenshot(scanId, flowConfig.steps.length - 1);
    }

    // --- Visual Regression ---
    await runVisualRegression({
      scanId,
      url,
      allIssues,
      config: config as { timeout?: number; visualDiffThreshold?: number },
    });

    db.prepare('UPDATE scans SET status = ?, completed_at = ? WHERE id = ?').run(
      ScanStatus.COMPLETED,
      new Date().toISOString(),
      scanId
    );

    console.log(`[ScanWorker] Scan ${scanId} completado. ${allIssues.length} issues encontrados.`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isHttp2Blocked = errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR') ||
                           errorMsg.includes('ERR_HTTP2_INADEQUATE_TRANSPORT_SECURITY') ||
                           errorMsg.includes('ERR_CONNECTION_CLOSED');

    if (isHttp2Blocked) {
      console.warn(`[ScanWorker] Acceso bloqueado por proteccion anti-bot en ${url} (scan ${scanId}): ${errorMsg}`);

      db.prepare(`
        INSERT INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        scanId,
        IssueType.FAILED_API,
        IssueSeverity.HIGH,
        url,
        url,
        `Acceso bloqueado: El sitio bloqueo el acceso al analizador mediante proteccion anti-bot. ` +
        `El servidor rechazo la conexion a nivel de protocolo HTTP/2. ` +
        `Esto es comun en sitios con proteccion avanzada (Akamai, Cloudflare, PerimeterX).`,
        JSON.stringify({
          errorType: 'ANTI_BOT_BLOCK',
          originalError: errorMsg.substring(0, 300),
          recomendacion: 'Este sitio requiere acceso desde un navegador real. No es un error del analizador.',
        }),
        null,
        new Date().toISOString()
      );

      db.prepare('UPDATE scans SET status = ?, completed_at = ? WHERE id = ?').run(
        ScanStatus.COMPLETED,
        new Date().toISOString(),
        scanId
      );

      console.log(`[ScanWorker] Scan ${scanId} completado con issue de acceso bloqueado.`);
      return;
    }

    console.error(`[ScanWorker] Error fatal en scan ${scanId}:`, error);

    try {
      db.prepare('UPDATE scans SET status = ?, completed_at = ? WHERE id = ?').run(
        ScanStatus.FAILED,
        new Date().toISOString(),
        scanId
      );
    } catch {}

    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
