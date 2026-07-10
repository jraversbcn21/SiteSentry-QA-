import { Page } from 'playwright';
import { randomUUID } from 'crypto';
import { Issue, IssueType, IssueSeverity, FlowStep, IChecker } from '../types';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import path from 'path';

interface FlowEngineParams {
  scanId: string;
  steps: FlowStep[];
  url: string;
  currentPage: Page;
  analyzer: PageAnalyzer;
  checkers: IChecker[];
  initialNetworkEvents: NetworkEvent[];
  initialConsoleErrors: ConsoleEvent[];
  config: { timeout?: number };
  updateProgress?: (progress: object) => void;
  screenshotDir: string;
}

export async function executeFlow(params: FlowEngineParams): Promise<{
  allIssues: Issue[];
  currentPage: Page;
}> {
  var scanId = params.scanId;
  var steps = params.steps;
  var url = params.url;
  var currentPage = params.currentPage;
  var analyzer = params.analyzer;
  var checkers = params.checkers;
  var config = params.config;
  var screenshotDir = params.screenshotDir;

  var allIssues: Issue[] = [];
  var stepNetworkEvents = params.initialNetworkEvents;
  var stepConsoleErrors = params.initialConsoleErrors;

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

  for (var stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    var step = steps[stepIdx];
    if (params.updateProgress) {
      try { params.updateProgress({ phase: 'running_flow_step', step: { index: stepIdx, total: steps.length, action: step.action } }); } catch {}
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
      } else if (step.action === 'checkpoint') {
        // checkpoint es un marcador sin accion
      } else {
        var unrecognizedMsg = 'Accion de paso no reconocida: ' + (step.action || '(vacia)');
        throw new Error(unrecognizedMsg);
      }
    } catch (stepErr) {
      var errorMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
      console.warn('[ScanWorker] Error en paso ' + stepIdx + ' (' + step.action + '):', errorMsg);
      allIssues.push({
        id: randomUUID(),
        type: 'FLOW_ERROR' as IssueType,
        severity: 'HIGH' as IssueSeverity,
        url: url,
        description: 'Error en paso ' + stepIdx + ' (' + step.action + '): ' + errorMsg,
        metadata: { stepIndex: stepIdx, action: step.action, error: errorMsg.substring(0, 300) },
        screenshot_path: undefined,
        stepIndex: stepIdx,
      });

      if (step.action === 'navigate') {
        console.warn('[ScanWorker] Navegacion fallida, abortando flujo');
        break;
      }
      continue;
    }

    var isCheckpoint = step.action === 'checkpoint' || step.action === 'navigate' || stepIdx === steps.length - 1;

    if (isCheckpoint) {
      try {
        await analyzer.fullScroll(currentPage);
      } catch {}

      for (var ci = 0; ci < checkers.length; ci++) {
        var checker = checkers[ci];
        try {
          var issues = await checker.check(url, currentPage, stepNetworkEvents, stepConsoleErrors);
          for (var ii = 0; ii < issues.length; ii++) {
            issues[ii].stepIndex = stepIdx;
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

        var stepIssues = allIssues.filter(function(iss) { return iss.stepIndex === stepIdx; });
        for (var si = 0; si < stepIssues.length; si++) {
          var sIssue = stepIssues[si];
          if (sIssue.severity !== 'HIGH') continue;
          var selector = sIssue.metadata?.selector as string | undefined;
          if (!selector) continue;
          try {
            var el = currentPage.locator(selector).first();
            var issueId = sIssue.id;
            if (!issueId) {
              issueId = randomUUID();
              sIssue.id = issueId;
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

  for (var fi = 0; fi < allIssues.length; fi++) {
    var flowIssue = allIssues[fi];
    if (!flowIssue.id) {
      flowIssue.id = randomUUID();
    }
  }

  return { allIssues, currentPage };
}
