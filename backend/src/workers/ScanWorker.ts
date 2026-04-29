import { Job } from 'bullmq';
import { chromium } from 'playwright';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/client';
import { ScanStatus } from '../types';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import { checkers } from '../checkers';

export async function processScanJob(job: Job) {
  const { scanId, url, config } = job.data;
  let browser = null;

  try {
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: ScanStatus.RUNNING },
    });

    console.log(`[ScanWorker] Analizando pagina: ${url} (scan ${scanId})`);

    await job.updateProgress({ phase: 'launching_browser' }).catch(() => {});

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-http2', // ✅ CAMBIO APLICADO — Forzar HTTP/1.1 para evitar ERR_HTTP2_PROTOCOL_ERROR
      ],
    });

    // Analyze the single page
    await job.updateProgress({ phase: 'loading_page' }).catch(() => {});

    const analyzer = new PageAnalyzer(browser, config.timeout || 30000);
    const analysis = await analyzer.analyze(url);

    console.log(
      `[ScanWorker] Pagina cargada (${analysis.statusCode}). ` +
      `Red: ${analysis.networkEvents.length} peticiones, ${analysis.failedRequests.length} fallidas. ` +
      `Consola: ${analysis.consoleErrors.length} errores.`
    );

    // Run all checkers against the analyzed page
    await job.updateProgress({ phase: 'running_checks' }).catch(() => {});

    const allIssues: import('../types').Issue[] = [];

    for (const checker of checkers) {
      try {
        const issues = await checker.check(url, analysis.page, analysis.networkEvents);
        allIssues.push(...issues);
        console.log(`[ScanWorker] ${checker.name}: ${issues.length} issues`);
      } catch (error) {
        console.error(`[ScanWorker] ${checker.name} fallo:`, error);
      }
    }

    // Add console errors as issues
    for (const consoleError of analysis.consoleErrors.slice(0, 20)) {
      // Skip common noise
      if (
        consoleError.text.includes('favicon.ico') ||
        consoleError.text.includes('third-party') ||
        consoleError.text.includes('[Fast Refresh]')
      ) continue;

      allIssues.push({
        type: 'BROKEN_RESOURCE' as import('../types').IssueType,
        severity: 'MEDIUM' as import('../types').IssueSeverity,
        url,
        description: `Error en consola: ${consoleError.text.substring(0, 200)}`,
        metadata: { source: consoleError.location, consoleType: consoleError.type },
      });
    }

    // Close the page
    await analyzer.close(analysis.page);

    // Save issues to DB
    await job.updateProgress({ phase: 'saving_results' }).catch(() => {});

    if (allIssues.length > 0) {
      const chunks = chunkArray(allIssues, 100);
      for (const chunk of chunks) {
        await prisma.issue.createMany({
          data: chunk.map((issue) => ({
            scanId,
            type: issue.type,
            severity: issue.severity,
            url: issue.url,
            sourceUrl: issue.sourceUrl || null,
            description: issue.description,
            metadata: (issue.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Mark scan as completed
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: ScanStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    console.log(`[ScanWorker] Scan ${scanId} completado. ${allIssues.length} issues encontrados.`);
  } catch (error) {
    // ✅ CAMBIO APLICADO — Detectar bloqueo anti-bot HTTP/2 y guardar issue informativo en vez de fallar
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isHttp2Blocked = errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR') ||
                           errorMsg.includes('ERR_HTTP2_INADEQUATE_TRANSPORT_SECURITY') ||
                           errorMsg.includes('ERR_CONNECTION_CLOSED');

    if (isHttp2Blocked) {
      console.warn(`[ScanWorker] Acceso bloqueado por proteccion anti-bot en ${url} (scan ${scanId}): ${errorMsg}`);

      await prisma.issue.create({
        data: {
          scanId,
          type: 'FAILED_API' as import('../types').IssueType,
          severity: 'HIGH' as import('../types').IssueSeverity,
          url,
          sourceUrl: url,
          description: `Acceso bloqueado: El sitio bloqueo el acceso al analizador mediante proteccion anti-bot. ` +
                       `El servidor rechazo la conexion a nivel de protocolo HTTP/2. ` +
                       `Esto es comun en sitios con proteccion avanzada (Akamai, Cloudflare, PerimeterX).`,
          metadata: {
            errorType: 'ANTI_BOT_BLOCK',
            originalError: errorMsg.substring(0, 300),
            recomendacion: 'Este sitio requiere acceso desde un navegador real. No es un error del analizador.',
          } as Prisma.InputJsonValue,
        },
      });

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: ScanStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      console.log(`[ScanWorker] Scan ${scanId} completado con issue de acceso bloqueado.`);
      return; // ✅ No lanza error, el scan se completa con el issue informativo
    }

    console.error(`[ScanWorker] Error fatal en scan ${scanId}:`, error);

    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: ScanStatus.FAILED,
        completedAt: new Date(),
      },
    }).catch(() => {});

    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
