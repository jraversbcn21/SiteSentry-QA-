import { randomUUID } from 'crypto';
import { getDb } from '../database/db';
import { ScanStatus } from '../types';
import path from 'path';
import fs from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

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

export interface RunVisualRegressionParams {
  scanId: string;
  url: string;
  allIssues: import('../types').Issue[];
  config: { timeout?: number; visualDiffThreshold?: number };
}

export async function runVisualRegression(params: RunVisualRegressionParams) {
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
      var issueId = issue.id;
      if (!issueId) continue;
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
