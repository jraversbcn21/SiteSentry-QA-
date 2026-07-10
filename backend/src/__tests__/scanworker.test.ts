var Database = require('better-sqlite3');

function createInMemoryDb() {
  var db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      url TEXT NOT NULL,
      source_url TEXT,
      description TEXT NOT NULL,
      metadata TEXT,
      screenshot_path TEXT,
      step_index INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS visual_diffs (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      baseline_scan_id TEXT NOT NULL,
      diff_type TEXT NOT NULL,
      issue_id TEXT,
      baseline_issue_id TEXT,
      element_identifier TEXT,
      diff_percentage REAL NOT NULL,
      diff_image_path TEXT,
      threshold_used REAL NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

var testDb = createInMemoryDb();

jest.mock('../database/db', () => ({
  getDb: jest.fn().mockImplementation(function() { return testDb; }),
}));

jest.mock('playwright', () => {
  var mockLocator = {
    first: function() { return this; },
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    hover: jest.fn().mockResolvedValue(undefined),
    press: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(undefined),
  };

  var mockPage = {
    goto: jest.fn().mockResolvedValue({ status: function() { return 200; } }),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    setDefaultTimeout: jest.fn(),
    on: jest.fn(),
    screenshot: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue(mockLocator),
    keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    evaluate: jest.fn().mockResolvedValue({ scrollHeight: 1000, viewportHeight: 768 }),
    context: jest.fn().mockReturnValue({ close: jest.fn() }),
  };

  return {
    chromium: {
      launch: jest.fn().mockResolvedValue({
        newContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(mockPage),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

jest.mock('../analyzer/PageAnalyzer', () => ({
  PageAnalyzer: jest.fn().mockImplementation(function() {
    return {
      analyze: jest.fn().mockResolvedValue({
        url: 'https://example.com',
        statusCode: 200,
        page: {
          goto: jest.fn(),
          waitForLoadState: jest.fn(),
          waitForTimeout: jest.fn(),
          setDefaultTimeout: jest.fn(),
          on: jest.fn(),
          screenshot: jest.fn(),
          locator: jest.fn().mockReturnValue({
            first: function() { return { screenshot: jest.fn(), click: jest.fn(), fill: jest.fn() }; },
          }),
          evaluate: jest.fn(),
          context: jest.fn().mockReturnValue({ close: jest.fn() }),
        },
        networkEvents: [],
        failedRequests: [],
        consoleErrors: [],
        loadTime: 500,
        scrollHeight: 2000,
        viewportHeight: 768,
      }),
      fullScroll: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

var mockChecker1Check = jest.fn().mockResolvedValue([
  { type: 'EMPTY_CONTENT', severity: 'HIGH', url: 'https://example.com', description: 'Mock issue 1' },
]);
var mockChecker2Check = jest.fn().mockResolvedValue([]);

jest.mock('../checkers', () => ({
  checkers: [
    { name: 'MockChecker1', check: mockChecker1Check },
    { name: 'MockChecker2', check: mockChecker2Check },
    { name: 'MockChecker3', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker4', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker5', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker6', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker7', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker8', check: jest.fn().mockResolvedValue([]) },
    { name: 'MockChecker9', check: jest.fn().mockResolvedValue([]) },
  ],
}));

jest.mock('../security/ssrf', () => ({
  validateUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('pixelmatch', () => jest.fn().mockReturnValue(0));
jest.mock('pngjs', () => ({
  PNG: { sync: { read: jest.fn(), write: jest.fn() } },
}));
jest.mock('sharp', () => jest.fn().mockReturnValue({
  ensureAlpha: jest.fn().mockReturnThis(),
  resize: jest.fn().mockReturnThis(),
  raw: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue({ data: Buffer.alloc(0), info: {} }),
}));

import { processScanJob } from '../workers/ScanWorker';
import { ScanStatus, IssueType, IssueSeverity } from '../types';
import fs from 'fs';
import path from 'path';

describe('processScanJob', () => {
  var screenshotDir: string;

  beforeEach(() => {
    testDb = createInMemoryDb();
    var mockGetDb = require('../database/db').getDb as jest.Mock;
    mockGetDb.mockReturnValue(testDb);

    screenshotDir = path.join(process.cwd(), 'data', 'screenshots', '__scanworker_test__');
    try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}

    mockChecker1Check.mockResolvedValue([
      { type: 'EMPTY_CONTENT', severity: 'HIGH', url: 'https://example.com', description: 'Mock issue 1' },
    ]);
    mockChecker2Check.mockResolvedValue([]);

    var ssrf = require('../security/ssrf');
    (ssrf.validateUrl as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    try { fs.rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
  });

  function createScan(id: string, url: string, config: any = {}) {
    testDb.prepare('INSERT INTO scans (id, url, status, config, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id, url, ScanStatus.PENDING, JSON.stringify(config), new Date().toISOString()
    );
  }

  describe('normal mode (sin flujo)', () => {
    it('debe completar scan: PENDING → RUNNING → COMPLETED', async () => {
      var scanId = 'normal-' + Date.now();
      createScan(scanId, 'https://example.com');

      var progressCalls: any[] = [];
      await processScanJob({
        data: { scanId, url: 'https://example.com', config: { timeout: 30000 } },
        updateProgress: async function(p: any) { progressCalls.push(p); },
      });

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.COMPLETED);
      expect(scan.completed_at).toBeTruthy();

      var issues = testDb.prepare('SELECT * FROM issues WHERE scan_id = ?').all(scanId) as any[];
      expect(issues.length).toBeGreaterThan(0);

      expect(progressCalls.length).toBeGreaterThan(0);
      var hasPhase = progressCalls.some(function(c: any) { return c.phase === 'launching_browser'; });
      expect(hasPhase).toBe(true);
    });

    it('debe llamar a todos los checkers', async () => {
      var scanId = 'checkers-' + Date.now();
      createScan(scanId, 'https://example.com');

      await processScanJob({
        data: { scanId, url: 'https://example.com', config: { timeout: 30000 } },
      });

      expect(mockChecker1Check).toHaveBeenCalled();
      expect(mockChecker2Check).toHaveBeenCalled();
    });

    it('debe persistir issues con todos los campos requeridos', async () => {
      var scanId = 'persist-' + Date.now();
      createScan(scanId, 'https://example.com');

      await processScanJob({
        data: { scanId, url: 'https://example.com', config: { timeout: 30000 } },
      });

      var issues = testDb.prepare('SELECT * FROM issues WHERE scan_id = ?').all(scanId) as any[];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('EMPTY_CONTENT');
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[0].id).toBeTruthy();
      expect(issues[0].created_at).toBeTruthy();
    });

    it('debe manejar errores de checkers sin fallar el scan', async () => {
      var scanId = 'checker-err-' + Date.now();
      createScan(scanId, 'https://example.com');

      mockChecker1Check.mockRejectedValueOnce(new Error('Checker exploded'));

      await processScanJob({
        data: { scanId, url: 'https://example.com', config: { timeout: 30000 } },
      });

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.COMPLETED);
    });
  });

  describe('flow mode (con flujo)', () => {
    it('debe ejecutar pasos del flujo y correr checkers en checkpoints', async () => {
      var scanId = 'flow-' + Date.now();
      createScan(scanId, 'https://example.com', {
        flow: { name: 'Test Flow', steps: [
          { action: 'navigate', url: 'https://example.com/page1' },
          { action: 'checkpoint' },
        ]},
      });

      await processScanJob({
        data: {
          scanId, url: 'https://example.com',
          config: { timeout: 30000, flow: { name: 'Test Flow', steps: [
            { action: 'navigate', url: 'https://example.com/page1' },
            { action: 'checkpoint' },
          ]}},
        },
      });

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.COMPLETED);

      var issues = testDb.prepare('SELECT * FROM issues WHERE scan_id = ?').all(scanId) as any[];
      expect(issues.length).toBeGreaterThan(0);
    });

    it('debe asignar step_index a issues del flujo', async () => {
      var scanId = 'flow-stepidx-' + Date.now();
      createScan(scanId, 'https://example.com', {
        flow: { name: 'Test Flow', steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'checkpoint' },
        ]},
      });

      await processScanJob({
        data: {
          scanId, url: 'https://example.com',
          config: { timeout: 30000, flow: { name: 'Test Flow', steps: [
            { action: 'navigate', url: 'https://example.com' },
            { action: 'checkpoint' },
          ]}},
        },
      });

      var issues = testDb.prepare('SELECT * FROM issues WHERE scan_id = ? AND step_index IS NOT NULL').all(scanId) as any[];
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('anti-bot handling', () => {
    it('debe clasificar bloqueo HTTP/2 como COMPLETED con issue FAILED_API/HIGH', async () => {
      var MockPA = require('../analyzer/PageAnalyzer').PageAnalyzer as jest.Mock;
      MockPA.mockImplementationOnce(function() {
        return {
          analyze: jest.fn().mockRejectedValue(new Error('net::ERR_HTTP2_PROTOCOL_ERROR')),
          fullScroll: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        };
      });

      var scanId = 'bot-' + Date.now();
      createScan(scanId, 'https://protected.example.com');

      await processScanJob({
        data: { scanId, url: 'https://protected.example.com', config: { timeout: 30000 } },
      });

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.COMPLETED);

      var issues = testDb.prepare('SELECT * FROM issues WHERE scan_id = ?').all(scanId) as any[];
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(IssueType.FAILED_API);
      expect(issues[0].severity).toBe(IssueSeverity.HIGH);

      var metadata = JSON.parse(issues[0].metadata);
      expect(metadata.errorType).toBe('ANTI_BOT_BLOCK');
    });

    it('debe fallar scan en error no-anti-bot', async () => {
      var MockPA = require('../analyzer/PageAnalyzer').PageAnalyzer as jest.Mock;
      MockPA.mockImplementationOnce(function() {
        return {
          analyze: jest.fn().mockRejectedValue(new Error('Something totally unexpected occurred')),
          fullScroll: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        };
      });

      var scanId = 'real-err-' + Date.now();
      createScan(scanId, 'https://example.com');

      await expect(
        processScanJob({ data: { scanId, url: 'https://example.com', config: { timeout: 30000 } } })
      ).rejects.toThrow();

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.FAILED);
    });
  });

  describe('SSRF protection', () => {
    it('debe fallar scan cuando SSRF bloquea la URL', async () => {
      var ssrf = require('../security/ssrf');
      (ssrf.validateUrl as jest.Mock).mockRejectedValueOnce(
        new Error('Acceso denegado: el hostname resuelve a una IP privada (10.0.0.1).')
      );

      var scanId = 'ssrf-' + Date.now();
      createScan(scanId, 'https://internal.corp.local');

      await processScanJob({
        data: { scanId, url: 'https://internal.corp.local', config: { timeout: 30000 } },
      });

      var scan = testDb.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as any;
      expect(scan.status).toBe(ScanStatus.FAILED);
    });
  });
});
