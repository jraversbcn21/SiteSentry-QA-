import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { getDb } from '../database/db';
import { ScanStatus, IssueType, IssueSeverity } from '../types';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import { checkers } from '../checkers';
import path from 'path';
import fs from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

interface JobData {
  scanId: string;
  url: string;
  config: { timeout?: number; flow?: import('../types').FlowInfo };
}

interface RunVisualRegressionParams {
  scanId: string;
  url: string;
  allIssues: import('../types').Issue[];
  config: { timeout?: number; visualDiffThreshold?: number };
}

interface DiffResult {
  diffPercentage: number;
  diffImage: PNG;
}

async function diffImages(baselinePath: string, currentPath: string, threshold: number): Promise<DiffResult> {
  var baselinePng: PNG = PNG.sync.read(fs.readFileSync(baselinePath));
  var currentPng: PNG = PNG.sync.read(fs.readFileSync(currentPath));

  var targetWidth = Math.min(baselinePng.width, currentPng.width);
  var targetHeight = Math.min(baselinePng.height, currentPng.height);

  if (baselinePng.width !== targetWidth || baselinePng.height !== targetHeight) {
    var resized = await sharp(fs.readFileSync(baselinePath))
      .ensureAlpha()
      .resize(targetWidth, targetHeight)
      .raw()
      .toBuffer({ resolveWithObject: true });
    baselinePng = new PNG({ width: targetWidth, height: targetHeight });
    resized.data.copy(baselinePng.data);
  }

  if (currentPng.width !== targetWidth || currentPng.height !== targetHeight) {
    var resized2 = await sharp(fs.readFileSync(currentPath))
      .ensureAlpha()
      .resize(targetWidth, targetHeight)
      .raw()
      .toBuffer({ resolveWithObject: true });
    currentPng = new PNG({ width: targetWidth, height: targetHeight });
    resized2.data.copy(currentPng.data);
  }

  var diffPng = new PNG({ width: targetWidth, height: targetHeight });
  var diffPixels = pixelmatch(
    baselinePng.data,
    currentPng.data,
    diffPng.data,
    targetWidth,
    targetHeight,
    { threshold: threshold }
  );

  var totalPixels = targetWidth * targetHeight;
  var diffPercentage = (diffPixels / totalPixels) * 100;

  return { diffPercentage, diffImage: diffPng };
}

async function runVisualRegression(params: RunVisualRegressionParams) {
  var scanId = params.scanId;
  var url = params.url;
  var allIssues = params.allIssues;
  var config = params.config;
  var db = getDb();

  try {
    var baselineScan = db.prepare(
      'SELECT id FROM scans WHERE url = ? AND is_baseline = 1 ORDER BY created_at DESC LIMIT 1'
    ).get(url) as { id: string } | undefined;

    if (!baselineScan) {
      baselineScan = db.prepare(
        'SELECT id FROM scans WHERE url = ? AND id != ? AND status = ? ORDER BY created_at DESC LIMIT 1'
      ).get(url, scanId, ScanStatus.COMPLETED) as { id: string } | undefined;
    }

    if (!baselineScan) {
      console.log('[ScanWorker] Sin baseline para regresion visual (primer scan de esta URL)');
      return;
    }

    console.log('[ScanWorker] Baseline encontrado: ' + baselineScan.id);

    var threshold = config.visualDiffThreshold ?? parseFloat(process.env.VISUAL_DIFF_THRESHOLD || '0.05');

    var screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
    var baselineDir = path.join(process.cwd(), 'data', 'screenshots', baselineScan.id);

    var currentFullPath = path.join(screenshotDir, 'full.png');
    var baselineFullPath = path.join(baselineDir, 'full.png');

    if (fs.existsSync(currentFullPath) && fs.existsSync(baselineFullPath)) {
      try {
        var diffResult = await diffImages(baselineFullPath, currentFullPath, threshold);
        var diffFullPath = path.join(screenshotDir, 'diff-full.png');
        fs.writeFileSync(diffFullPath, PNG.sync.write(diffResult.diffImage));
        var diffId = randomUUID();
        db.prepare(
          'INSERT INTO visual_diffs (id, scan_id, baseline_scan_id, diff_type, issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at) VALUES (?, ?, ?, \'full_page\', NULL, NULL, ?, ?, ?, ?)'
        ).run(diffId, scanId, baselineScan.id, diffResult.diffPercentage, scanId + '/diff-full.png', threshold, new Date().toISOString());
        console.log('[ScanWorker] Full-page diff: ' + diffResult.diffPercentage.toFixed(1) + '% diferente');
      } catch (err) {
        console.warn('[ScanWorker] Full-page diff fallo:', err);
      }
    }

    var baselineIssues = db.prepare(
      'SELECT id, type, url, metadata, screenshot_path FROM issues WHERE scan_id = ?'
    ).all(baselineScan.id) as Array<{
      id: string;
      type: string;
      url: string;
      metadata: string | null;
      screenshot_path: string | null;
    }>;

    for (var i = 0; i < allIssues.length; i++) {
      var issue = allIssues[i];
      var issueId = (issue as any).id as string;
      if (issue.severity !== 'HIGH') continue;
      if (!issue.screenshot_path) continue;

      var currentIssuePath = path.join(screenshotDir, issueId + '.png');

      var matchedBaseline: typeof baselineIssues[0] | null = null;
      var elementIdentifier = '';

      var selector = issue.metadata?.selector as string | undefined;

      for (var j = 0; j < baselineIssues.length; j++) {
        var baselineIssue = baselineIssues[j];
        if (!baselineIssue.screenshot_path) continue;

        if (selector && baselineIssue.metadata) {
          try {
            var baselineMeta = JSON.parse(baselineIssue.metadata);
            if (baselineMeta.selector === selector) {
              matchedBaseline = baselineIssue;
              elementIdentifier = selector;
              break;
            }
          } catch {}
        }
      }

      if (!matchedBaseline) {
        for (var k = 0; k < baselineIssues.length; k++) {
          var bi = baselineIssues[k];
          if (!bi.screenshot_path) continue;
          if (bi.type === issue.type && bi.url === issue.url) {
            matchedBaseline = bi;
            elementIdentifier = bi.type + ':' + bi.url;
            break;
          }
        }
      }

      if (!matchedBaseline) continue;

      var baselineIssueId = matchedBaseline.id;
      var baselineIssuePath = path.join(baselineDir, baselineIssueId + '.png');

      if (!fs.existsSync(currentIssuePath)) continue;
      if (!fs.existsSync(baselineIssuePath)) continue;

      try {
        var elDiffResult = await diffImages(baselineIssuePath, currentIssuePath, threshold);
        var diffIssuePath = path.join(screenshotDir, 'diff-' + issueId + '.png');
        fs.writeFileSync(diffIssuePath, PNG.sync.write(elDiffResult.diffImage));
        var elDiffId = randomUUID();
        db.prepare(
          'INSERT INTO visual_diffs (id, scan_id, baseline_scan_id, diff_type, issue_id, baseline_issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at) VALUES (?, ?, ?, \'element\', ?, ?, ?, ?, ?, ?, ?)'
        ).run(elDiffId, scanId, baselineScan.id, issueId, baselineIssueId, elementIdentifier, elDiffResult.diffPercentage, scanId + '/diff-' + issueId + '.png', threshold, new Date().toISOString());
      } catch (err) {
        console.debug('[ScanWorker] Element diff fallo para issue ' + issueId + ':', err);
      }
    }

    console.log('[ScanWorker] Regresion visual completada');
  } catch (err) {
    console.warn('[ScanWorker] Regresion visual fallo (best effort):', err);
  }
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

    var flowConfig = config.flow;
    var allIssues: import('../types').Issue[] = [];
    var currentPage = analysis.page;

    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      console.log('[ScanWorker] Ejecutando flujo interactivo: ' + flowConfig.name + ' (' + flowConfig.steps.length + ' pasos)');

      var screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
      try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}

      var stepNetworkEvents = analysis.networkEvents;
      var stepConsoleErrors = analysis.consoleErrors;

      var onResponse = function(response: any) {
        stepNetworkEvents.push({
          url: response.url(),
          method: response.request().method(),
          resourceType: response.request().resourceType(),
          status: response.status(),
          statusText: response.statusText(),
          failed: false,
          failureText: null,
          timing: 0,
          size: 0,
          mimeType: response.headers()['content-type'] || '',
        });
      };
      var onRequestFailed = function(request: any) {
        stepNetworkEvents.push({
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          status: null,
          statusText: '',
          failed: true,
          failureText: request.failure()?.errorText || 'Unknown error',
          timing: 0,
          size: 0,
          mimeType: '',
        });
      };
      var onConsole = function(msg: any) {
        if (msg.type() === 'error') {
          stepConsoleErrors.push({ text: msg.text(), type: msg.type(), location: msg.location()?.url || '' });
        }
      };
      var listenersAttached = false;

      for (var stepIdx = 0; stepIdx < flowConfig.steps.length; stepIdx++) {
        var step = flowConfig.steps[stepIdx];
        if (job.updateProgress) {
          try { job.updateProgress({ phase: 'running_flow_step', step: { index: stepIdx, total: flowConfig.steps.length, action: step.action } }); } catch {}
        }

        try {
          if (step.action === 'navigate') {
            stepNetworkEvents = [];
            stepConsoleErrors = [];
            if (!listenersAttached) {
              currentPage.on('response', onResponse);
              currentPage.on('requestfailed', onRequestFailed);
              currentPage.on('console', onConsole);
              listenersAttached = true;
            }
            await currentPage.goto(step.url || '', { waitUntil: 'domcontentloaded', timeout: config.timeout || 30000 });
            await currentPage.waitForLoadState('networkidle').catch(function() {});
          } else if (step.action === 'click' && step.selector) {
            await currentPage.locator(step.selector).first().click({ timeout: 10000 });
            await currentPage.waitForTimeout(1000);
          } else if (step.action === 'type' && step.selector && step.value !== undefined) {
            await currentPage.locator(step.selector).first().fill(step.value, { timeout: 10000 });
          } else if (step.action === 'wait' && step.ms) {
            await currentPage.waitForTimeout(step.ms);
          } else if (step.action === 'select' && step.selector && step.value !== undefined) {
            await currentPage.locator(step.selector).first().selectOption(step.value, { timeout: 10000 });
          } else if (step.action === 'hover' && step.selector) {
            await currentPage.locator(step.selector).first().hover({ timeout: 10000 });
          } else if (step.action === 'press' && step.key) {
            if (step.selector) {
              await currentPage.locator(step.selector).first().press(step.key, { timeout: 10000 });
            } else {
              await currentPage.keyboard.press(step.key);
            }
          }
        } catch (stepErr) {
          var errorMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
          console.warn('[ScanWorker] Error en paso ' + stepIdx + ' (' + step.action + '):', errorMsg);
          allIssues.push({
            type: 'FLOW_ERROR' as any,
            severity: 'HIGH' as any,
            url: url,
            description: 'Error en paso ' + stepIdx + ' (' + step.action + '): ' + errorMsg,
            metadata: { stepIndex: stepIdx, action: step.action, error: errorMsg.substring(0, 300) },
            screenshot_path: undefined,
          } as any);
          (allIssues[allIssues.length - 1] as any).stepIndex = stepIdx;

          if (step.action === 'navigate') {
            console.warn('[ScanWorker] Navegacion fallida, abortando flujo');
            break;
          }
          continue;
        }

        var isCheckpoint = step.action === 'checkpoint' || step.action === 'navigate' || stepIdx === flowConfig.steps.length - 1;

        if (isCheckpoint) {
          try {
            await analyzer.fullScroll(currentPage);
          } catch {}

          for (var ci = 0; ci < checkers.length; ci++) {
            var checker = checkers[ci];
            try {
              var issues = await checker.check(url, currentPage, stepNetworkEvents, stepConsoleErrors);
              for (var ii = 0; ii < issues.length; ii++) {
                (issues[ii] as any).stepIndex = stepIdx;
              }
              allIssues.push(...issues);
              console.log('[ScanWorker] ' + checker.name + ' (paso ' + stepIdx + '): ' + issues.length + ' issues');
            } catch (checkerErr) {
              console.error('[ScanWorker] ' + checker.name + ' fallo en paso ' + stepIdx + ':', checkerErr);
            }
          }

          try {
            var stepFullPath = path.join(screenshotDir, 'step-' + stepIdx + '-full.png');
            await currentPage.screenshot({ path: stepFullPath, fullPage: true, type: 'png' });

            var stepIssues = allIssues.filter(function(iss: any) { return (iss as any).stepIndex === stepIdx; });
            for (var si = 0; si < stepIssues.length; si++) {
              var sIssue = stepIssues[si];
              if (sIssue.severity !== 'HIGH') continue;
              var selector = sIssue.metadata?.selector as string | undefined;
              if (!selector) continue;
              try {
                var el = currentPage.locator(selector).first();
                var issueId = (sIssue as any).id;
                if (!issueId) {
                  issueId = randomUUID();
                  (sIssue as any).id = issueId;
                }
                var elFileName = 'step-' + stepIdx + '-' + issueId + '.png';
                var elFilePath = path.join(screenshotDir, elFileName);
                await el.screenshot({ path: elFilePath, type: 'png' });
                sIssue.screenshot_path = scanId + '/' + elFileName;
              } catch {}
            }
          } catch (screenshotErr) {
            console.warn('[ScanWorker] Screenshots fallaron en paso ' + stepIdx + ':', screenshotErr);
          }
        }
      }

      // Asignar IDs a issues del flujo antes de persistir
      for (var fi = 0; fi < allIssues.length; fi++) {
        var flowIssue = allIssues[fi];
        if (!(flowIssue as any).id) {
          (flowIssue as any).id = randomUUID();
        }
      }

      await analyzer.close(currentPage);
    } else {
      if (job.updateProgress) {
        try { job.updateProgress({ phase: 'running_checks' }); } catch {}
      }

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
            console.debug(`[ScanWorker] Elemento no encontrado para screenshot: ${selector}`);
          }
        }
      } catch (err) {
        console.warn('[ScanWorker] No se pudo crear directorio de screenshots, omitiendo capturas:', err);
      }

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
            (issue as any).id,
            scanId,
            issue.type,
            issue.severity,
            issue.url,
            issue.sourceUrl || null,
            issue.description,
            issue.metadata ? JSON.stringify(issue.metadata) : null,
            issue.screenshot_path || null,
            (issue as any).stepIndex ?? null,
            new Date().toISOString()
          );
        }
      });

      insertMany(allIssues);
    }

    // Copiar ultimo step full-page como full.png para regresion visual
    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      var lastIdx = flowConfig.steps.length - 1;
      var lastFullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'step-' + lastIdx + '-full.png');
      var fullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'full.png');
      if (fs.existsSync(lastFullPath)) {
        try { fs.copyFileSync(lastFullPath, fullPath); } catch {}
      }
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
