import { chromium, Browser, Page } from 'playwright';
import { ContentChecker } from '../checkers/ContentChecker';
import { InteractivityChecker } from '../checkers/InteractivityChecker';
import { FormModalChecker } from '../checkers/FormModalChecker';
import { LazyLoadChecker } from '../checkers/LazyLoadChecker';
import { BrokenResourcesChecker } from '../checkers/BrokenResourcesChecker';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

var TEST_URL = 'https://test.example.com';

describe('Checkers — fixture tests', () => {
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
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  describe('ContentChecker', () => {
    var checker = new ContentChecker();

    it('debe detectar contenedores vacios visibles', async () => {
      await page.setContent(`
        <html><body>
          <main style="min-height: 100px; min-width: 200px;"></main>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('EMPTY_CONTENT');
      expect(issues[0].severity).toBe('HIGH');
    });

    it('debe detectar mensajes de error visibles', async () => {
      await page.setContent(`
        <html><body>
          <div class="error" role="alert">Error: algo salio mal</div>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var errorIssues = issues.filter(function(i: any) { return i.description.indexOf('Mensaje de error') >= 0; });
      expect(errorIssues.length).toBeGreaterThan(0);
    });

    it('debe detectar contenedor principal vacio', async () => {
      await page.setContent(`
        <html><body>
          <main></main>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var emptyMainIssues = issues.filter(function(i: any) { return i.description.indexOf('posible fallo de renderizado') >= 0; });
      expect(emptyMainIssues.length).toBeGreaterThan(0);
    });
  });

  describe('InteractivityChecker', () => {
    var checker = new InteractivityChecker();

    it('debe detectar enlaces placeholder (href="#")', async () => {
      await page.setContent(`
        <html><body>
          <a href="#">Click aqui</a>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var placeholderIssues = issues.filter(function(i: any) { return i.description.indexOf('placeholder') >= 0; });
      expect(placeholderIssues.length).toBeGreaterThan(0);
    });

    it('debe detectar enlaces sin href', async () => {
      await page.setContent(`
        <html><body>
          <a role="button">Sin destino</a>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var noHrefIssues = issues.filter(function(i: any) { return i.description.indexOf('href') >= 0; });
      expect(noHrefIssues.length).toBeGreaterThan(0);
    });

    it('no debe reportar enlaces validos', async () => {
      await page.setContent(`
        <html><body>
          <a href="https://example.com">Enlace valido</a>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      expect(issues.length).toBe(0);
    });
  });

  describe('FormModalChecker', () => {
    var checker = new FormModalChecker();

    it('debe detectar formulario sin boton de envio', async () => {
      await page.setContent(`
        <html><body>
          <form>
            <input type="text" name="username">
            <input type="password" name="pass">
          </form>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var noSubmitIssues = issues.filter(function(i: any) { return i.description.indexOf('sin boton de envio') >= 0; });
      expect(noSubmitIssues.length).toBeGreaterThan(0);
    });

    it('debe detectar formulario sin action definido', async () => {
      await page.setContent(`
        <html><body>
          <form action="#">
            <input type="text" name="q">
            <button type="submit">Buscar</button>
          </form>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var noActionIssues = issues.filter(function(i: any) { return i.description.indexOf('sin action') >= 0; });
      expect(noActionIssues.length).toBeGreaterThan(0);
    });

    it('no debe reportar formulario valido', async () => {
      await page.setContent(`
        <html><body>
          <form action="/submit" method="post">
            <input type="text" name="email">
            <button type="submit">Enviar</button>
          </form>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      var formIssues = issues.filter(function(i: any) { return i.type === 'FORM_MODAL' && (i.description.indexOf('sin boton') >= 0 || i.description.indexOf('sin action') >= 0); });
      expect(formIssues.length).toBe(0);
    });
  });

  describe('LazyLoadChecker', () => {
    var checker = new LazyLoadChecker();

    it('debe detectar imagenes lazy no cargadas', async () => {
      await page.setContent(`
        <html><body style="height:2000px">
          <img loading="lazy" src="https://test.example.com/broken.png" style="width:100px;height:100px;position:absolute;top:0;left:0;">
        </body></html>
      `);
      await page.waitForTimeout(500);

      var issues = await checker.check(TEST_URL, page, []);
      var lazyIssues = issues.filter(function(i: any) { return i.description.indexOf('lazy-load') >= 0 || i.description.indexOf('placeholder') >= 0; });
      expect(lazyIssues.length).toBeGreaterThan(0);
    });

    it('debe detectar spinners/skeletons visibles', async () => {
      await page.setContent(`
        <html><body>
          <div class="spinner" style="width:50px;height:50px;"></div>
          <div class="skeleton" style="width:200px;height:20px;"></div>
        </body></html>
      `);
      await page.waitForTimeout(200);

      var issues = await checker.check(TEST_URL, page, []);
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('BrokenResourcesChecker', () => {
    var checker = new BrokenResourcesChecker();

    it('debe detectar recursos rotos via network events', async () => {
      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/broken.js', method: 'GET', resourceType: 'script', status: 404, statusText: 'Not Found', failed: false, failureText: null, timing: 100, size: 0, mimeType: 'application/javascript' },
        { url: 'https://test.example.com/broken.css', method: 'GET', resourceType: 'stylesheet', status: 500, statusText: 'Internal Server Error', failed: false, failureText: null, timing: 80, size: 0, mimeType: 'text/css' },
        { url: 'https://test.example.com/image.png', method: 'GET', resourceType: 'image', status: null, statusText: '', failed: true, failureText: 'net::ERR_CONNECTION_REFUSED', timing: 200, size: 0, mimeType: '' },
        { url: 'https://test.example.com/ok.js', method: 'GET', resourceType: 'script', status: 200, statusText: 'OK', failed: false, failureText: null, timing: 50, size: 1000, mimeType: 'application/javascript' },
      ];

      var issues = await checker.check(TEST_URL, page, networkEvents);
      expect(issues.length).toBe(3);

      var types = issues.map(function(i: any) { return i.type; });
      expect(types.every(function(t: string) { return t === 'BROKEN_RESOURCE'; })).toBe(true);

      var scriptIssues = issues.filter(function(i: any) { return i.description.indexOf('Script') >= 0; });
      expect(scriptIssues.length).toBe(1);
      expect(scriptIssues[0].severity).toBe('HIGH');
    });

    it('debe detectar imagenes del DOM no renderizadas', async () => {
      await page.route('**/*', function(route: any) {
        var url = route.request().url();
        if (url.indexOf('nonexistent') >= 0) {
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });

      await page.setContent(`
        <html><body>
          <img src="https://test.example.com/nonexistent.jpg" alt="Imagen rota" style="width:100px;height:100px;">
        </body></html>
      `);
      await page.waitForTimeout(1000);

      var issues = await checker.check(TEST_URL, page, []);
      var domIssues = issues.filter(function(i: any) { return i.description.indexOf('no renderizada') >= 0; });
      expect(domIssues.length).toBeGreaterThan(0);
    }, 15000);
  });
});
