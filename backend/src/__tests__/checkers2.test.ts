import { chromium, Browser, Page } from 'playwright';
import { FailedAPIChecker } from '../checkers/FailedAPIChecker';
import { ConsoleErrorChecker } from '../checkers/ConsoleErrorChecker';
import { PerformanceChecker } from '../checkers/PerformanceChecker';
import { AccessibilityChecker } from '../checkers/AccessibilityChecker';
import { NetworkEvent, ConsoleEvent } from '../analyzer/PageAnalyzer';
import { PageFacts } from '../checkers/pageFacts';

var TEST_URL = 'https://test.example.com';

var EMPTY_PERFORMANCE: PageFacts['performance'] = {
  ttfb: 0,
  domContentLoaded: 0,
  fullLoad: 0,
  domNodes: 0,
  resourceCount: 0,
  totalTransferKB: 0,
};

function factsWithPerformance(overrides: Partial<PageFacts['performance']>): PageFacts {
  return {
    brokenImages: [],
    backgroundImageUrls: [],
    emptyContainers: [],
    errorStates: [],
    mainContent: { mainHasContent: false },
    corsCandidates: [],
    formIssues: [],
    modals: [],
    cookieBlocker: { found: false },
    deadButtons: [],
    placeholderLinks: [],
    pseudoDisabledButtons: [],
    lazyImages: [],
    spinners: [],
    placeholderImages: [],
    performance: { ...EMPTY_PERFORMANCE, ...overrides },
  } as PageFacts;
}

describe('Checkers — fixture tests (parte 2)', () => {
  jest.setTimeout(30000);
  var browser: Browser;
  var page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    var context = await browser.newContext();
    page = await context.newPage();
  });

  afterEach(async () => {
    await page.context().close();
  });

  describe('FailedAPIChecker', () => {
    var checker = new FailedAPIChecker();

    it('debe detectar llamadas XHR/fetch fallidas', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/api/data', method: 'GET', resourceType: 'fetch', status: null, statusText: '', failed: true, failureText: 'net::ERR_CONNECTION_REFUSED', timing: 50, size: 0, mimeType: '' },
      ];

      var issues = await checker.check(TEST_URL, page, networkEvents);
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('FAILED_API');
      expect(issues[0].severity).toBe('HIGH');
    });

    it('debe clasificar 5xx como HIGH y 4xx como MEDIUM', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/api/a', method: 'GET', resourceType: 'xhr', status: 500, statusText: 'Internal Server Error', failed: false, failureText: null, timing: 100, size: 0, mimeType: 'application/json' },
        { url: 'https://test.example.com/api/b', method: 'GET', resourceType: 'xhr', status: 404, statusText: 'Not Found', failed: false, failureText: null, timing: 100, size: 0, mimeType: 'application/json' },
      ];

      var issues = await checker.check(TEST_URL, page, networkEvents);
      expect(issues.length).toBe(2);
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[1].severity).toBe('MEDIUM');
    });

    it('debe detectar APIs extremadamente lentas (>10s)', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/api/slow', method: 'GET', resourceType: 'xhr', status: 200, statusText: 'OK', failed: false, failureText: null, timing: 15000, size: 0, mimeType: 'application/json' },
      ];

      var issues = await checker.check(TEST_URL, page, networkEvents);
      expect(issues.length).toBe(1);
      expect(issues[0].description).toContain('lenta');
    });

    it('no debe reportar recursos estaticos como API fallida', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/style.css', method: 'GET', resourceType: 'stylesheet', status: 404, statusText: 'Not Found', failed: false, failureText: null, timing: 50, size: 0, mimeType: 'text/css' },
      ];

      var issues = await checker.check(TEST_URL, page, networkEvents);
      expect(issues.length).toBe(0);
    });

    it('debe detectar posible error CORS via facts.corsCandidates', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://other-origin.example.com/api/data', method: 'GET', resourceType: 'other', status: null, statusText: '', failed: true, failureText: 'net::ERR_FAILED', timing: 30, size: 0, mimeType: '' },
      ];
      var facts = factsWithPerformance({});
      facts.corsCandidates = [{ url: 'https://other-origin.example.com/api/data', duration: 30 }];

      var issues = await checker.check(TEST_URL, page, networkEvents, [], facts);
      expect(issues.length).toBe(1);
      expect(issues[0].metadata?.possibleCORS).toBe(true);
    });
  });

  describe('ConsoleErrorChecker', () => {
    var checker = new ConsoleErrorChecker();

    it('debe detectar errores JS no capturados como HIGH', async () => {
      var consoleErrors: ConsoleEvent[] = [
        { type: 'error', text: 'Uncaught TypeError: Cannot read properties of undefined', location: 'app.js:10' },
      ];

      var issues = await checker.check(TEST_URL, page, [], consoleErrors);
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('CONSOLE_ERROR');
      expect(issues[0].severity).toBe('HIGH');
    });

    it('debe ignorar ruido conocido (favicon, webpack, extensiones)', async () => {
      var consoleErrors: ConsoleEvent[] = [
        { type: 'error', text: 'GET https://test.example.com/favicon.ico 404', location: '' },
        { type: 'log', text: '[Fast Refresh] rebuilding', location: '' },
      ];

      var issues = await checker.check(TEST_URL, page, [], consoleErrors);
      expect(issues.length).toBe(0);
    });

    it('debe deduplicar mensajes repetidos', async () => {
      var consoleErrors: ConsoleEvent[] = [
        { type: 'error', text: 'Something broke here', location: 'a.js:1' },
        { type: 'error', text: 'Something broke here', location: 'a.js:1' },
      ];

      var issues = await checker.check(TEST_URL, page, [], consoleErrors);
      expect(issues.length).toBe(1);
    });

    it('debe limitar a 30 errores de consola', async () => {
      var consoleErrors: ConsoleEvent[] = Array.from({ length: 50 }, function(_, i) {
        return { type: 'error', text: 'Error unico numero ' + i, location: '' };
      });

      var issues = await checker.check(TEST_URL, page, [], consoleErrors);
      expect(issues.length).toBe(30);
    });
  });

  describe('PerformanceChecker', () => {
    var checker = new PerformanceChecker();

    it('debe reportar TTFB alto como HIGH', async () => {
      var facts = factsWithPerformance({ ttfb: 2500 });
      var issues = await checker.check(TEST_URL, page, [], [], facts);
      var ttfbIssue = issues.find(function(i) { return i.metadata?.metric === 'ttfb'; });
      expect(ttfbIssue).toBeDefined();
      expect(ttfbIssue?.severity).toBe('HIGH');
    });

    it('debe reportar DOM excesivamente grande', async () => {
      var facts = factsWithPerformance({ domNodes: 5000 });
      var issues = await checker.check(TEST_URL, page, [], [], facts);
      var domIssue = issues.find(function(i) { return i.metadata?.metric === 'domNodes'; });
      expect(domIssue).toBeDefined();
      expect(domIssue?.severity).toBe('MEDIUM');
    });

    it('debe reportar exceso de recursos de red', async () => {
      var facts = factsWithPerformance({ resourceCount: 250, totalTransferKB: 3000 });
      var issues = await checker.check(TEST_URL, page, [], [], facts);
      var resourceIssue = issues.find(function(i) { return i.metadata?.metric === 'resourceCount'; });
      expect(resourceIssue).toBeDefined();
      expect(resourceIssue?.severity).toBe('MEDIUM');
    });

    it('no debe reportar nada cuando las metricas estan dentro de umbrales', async () => {
      var facts = factsWithPerformance({ ttfb: 100, domContentLoaded: 500, fullLoad: 800, domNodes: 300, resourceCount: 20 });
      var issues = await checker.check(TEST_URL, page, [], [], facts);
      expect(issues.length).toBe(0);
    });

    it('debe reportar recursos bloqueantes lentos via network events', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/big.js', method: 'GET', resourceType: 'script', status: 200, statusText: 'OK', failed: false, failureText: null, timing: 6000, size: 500000, mimeType: 'application/javascript' },
      ];
      var facts = factsWithPerformance({});
      var issues = await checker.check(TEST_URL, page, networkEvents, [], facts);
      var slowIssue = issues.find(function(i) { return i.metadata?.metric === 'slowResource'; });
      expect(slowIssue).toBeDefined();
    });
  });

  describe('AccessibilityChecker', () => {
    var checker = new AccessibilityChecker();

    it('debe detectar imagenes sin texto alternativo', async () => {
      await page.setContent(`
        <html><body>
          <img src="https://test.example.com/photo.jpg" style="width:100px;height:100px;">
        </body></html>
      `);

      var issues = await checker.check(TEST_URL, page, []);
      var altIssue = issues.find(function(i) { return i.metadata?.ruleId === 'image-alt'; });
      expect(altIssue).toBeDefined();
      expect(altIssue?.type).toBe('ACCESSIBILITY');
    });

    it('debe detectar pagina sin <html lang>', async () => {
      await page.setContent(`
        <html><body>
          <main><h1>Titulo</h1></main>
        </body></html>
      `);

      var issues = await checker.check(TEST_URL, page, []);
      var langIssue = issues.find(function(i) { return i.metadata?.ruleId === 'html-has-lang'; });
      expect(langIssue).toBeDefined();
    });

    it('no debe reportar violaciones en una pagina accesible minima', async () => {
      await page.setContent(`
        <html lang="es"><head><title>Pagina de prueba</title></head><body>
          <main><h1>Titulo accesible</h1></main>
        </body></html>
      `);

      var issues = await checker.check(TEST_URL, page, []);
      var criticalIssues = issues.filter(function(i) { return i.severity === 'HIGH'; });
      expect(criticalIssues.length).toBe(0);
    });
  });
});
