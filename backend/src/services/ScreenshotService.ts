import { Page } from 'playwright';
import { randomUUID } from 'crypto';
import { Issue } from '../types';
import path from 'path';
import fs from 'fs';

export function ensureScreenshotDir(scanId: string): string {
  var screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
  try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}
  return screenshotDir;
}

export async function captureFullPage(page: Page, scanId: string, filename?: string): Promise<string | null> {
  try {
    var dir = ensureScreenshotDir(scanId);
    var name = filename || 'full.png';
    var fullPath = path.join(dir, name);
    await page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
    console.log('[ScanWorker] Full-page screenshot capturado');
    return fullPath;
  } catch (err) {
    console.warn('[ScanWorker] No se pudo capturar full-page screenshot:', err);
    return null;
  }
}

export async function captureElementScreenshots(
  page: Page,
  scanId: string,
  issues: Issue[]
): Promise<void> {
  var dir = ensureScreenshotDir(scanId);

  for (var i = 0; i < issues.length; i++) {
    var issue = issues[i];
    if (issue.severity !== 'HIGH') continue;
    var selector = issue.metadata?.selector as string | undefined;
    if (!selector) continue;

    if (!issue.id) {
      issue.id = randomUUID();
    }

    try {
      var el = page.locator(selector).first();
      var fileName = issue.id + '.png';
      var filePath = path.join(dir, fileName);
      await el.screenshot({ path: filePath, type: 'png' });
      issue.screenshot_path = scanId + '/' + fileName;
    } catch {
      console.debug('[ScanWorker] Elemento no encontrado para screenshot: ' + selector);
    }
  }
}

export function copyLastStepScreenshot(scanId: string, lastStepIdx: number): void {
  var lastFullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'step-' + lastStepIdx + '-full.png');
  var fullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'full.png');
  if (fs.existsSync(lastFullPath)) {
    try { fs.copyFileSync(lastFullPath, fullPath); } catch {}
  }
}
