import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { getDb } from '../database/db';
import { ScanStatus, IssueType, IssueSeverity } from '../types';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import { checkers } from '../checkers';
import path from 'path';
import fs from 'fs';

interface JobData {
  scanId: string;
  url: string;
  config: { timeout?: number };
}

export async function processScanJob(job: { data: JobData; updateProgress?: (progress: object) => void }) {
  const { scanId, url, config } = job.data;
  let browser = null;
  const db = getDb();

  try {
    db.prepare('UPDATE scans SET status = ? WHERE id = ?').run(ScanStatus.RUNNING, scanId);

    console.log(`[ScanWorker] Analizando pagina: ${url} (scan ${scanId})`);

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

    if (job.updateProgress) {
      try { job.updateProgress({ phase: 'running_checks' }); } catch {}
    }

    const allIssues: import('../types').Issue[] = [];

    for (const checker of checkers) {
      try {
        const issues = await checker.check(url, analysis.page, analysis.networkEvents, analysis.consoleErrors);
        allIssues.push(...issues);
        console.log(`[ScanWorker] ${checker.name}: ${issues.length} issues`);
      } catch (error) {
        console.error(`[ScanWorker] ${checker.name} fallo:`, error);
      }
    }

    // Asignar IDs a issues antes de screenshots (necesario para nombres de archivo)
    for (const issue of allIssues) {
      (issue as any).id = randomUUID();
    }

    // --- Captura de screenshots ---
    try {
      const screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
      fs.mkdirSync(screenshotDir, { recursive: true });

      // Full-page screenshot
      try {
        const fullPath = path.join(screenshotDir, 'full.png');
        await analysis.page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
        console.log('[ScanWorker] Full-page screenshot capturado');
      } catch (err) {
        console.warn('[ScanWorker] No se pudo capturar full-page screenshot:', err);
      }

      // Element screenshots for HIGH severity issues with selectors
      for (const issue of allIssues) {
        if (issue.severity !== 'HIGH') continue;
        const selector = issue.metadata?.selector as string | undefined;
        if (!selector) continue;

        try {
          const el = analysis.page.locator(selector).first();
          const fileName = `${(issue as any).id}.png`;
          const filePath = path.join(screenshotDir, fileName);
          await el.screenshot({ path: filePath, type: 'png' });
          issue.screenshot_path = `${scanId}/${fileName}`;
        } catch {
          // Elemento no encontrado o no visible — se omite el screenshot sin error
        }
      }
    } catch (err) {
      console.warn('[ScanWorker] No se pudo crear directorio de screenshots, omitiendo capturas:', err);
    }

    await analyzer.close(analysis.page);

    if (job.updateProgress) {
      try { job.updateProgress({ phase: 'saving_results' }); } catch {}
    }

    if (allIssues.length > 0) {
      const insertIssue = db.prepare(`
        INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((issues: import('../types').Issue[]) => {
        for (const issue of issues) {
          insertIssue.run(
            (issue as any).id,
            scanId,
            issue.type,
            issue.severity,
            issue.url,
            issue.sourceUrl || null,
            issue.description,
            issue.metadata ? JSON.stringify(issue.metadata) : null,
            issue.screenshot_path || null,
            new Date().toISOString()
          );
        }
      });

      insertMany(allIssues);
    }

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
