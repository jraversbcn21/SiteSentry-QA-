import { Browser, Page, Request, Response } from 'playwright';

export interface NetworkEvent {
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  statusText: string;
  failed: boolean;
  failureText: string | null;
  timing: number;
  size: number;
  mimeType: string;
}

export interface ConsoleEvent {
  type: string;
  text: string;
  location: string;
}

export interface PageAnalysis {
  url: string;
  statusCode: number;
  page: Page;
  networkEvents: NetworkEvent[];
  failedRequests: NetworkEvent[];
  consoleErrors: ConsoleEvent[];
  loadTime: number;
  scrollHeight: number;
  viewportHeight: number;
}

export class PageAnalyzer {
  private browser: Browser;
  private timeout: number;

  constructor(browser: Browser, timeout = 60000) {
    this.browser = browser;
    this.timeout = timeout;
  }

  async analyze(url: string): Promise<PageAnalysis> {
    // ✅ CAMBIO APLICADO — Crear contexto con fingerprint realista para evitar bloqueos anti-bot
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      extraHTTPHeaders: {
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    const page = await context.newPage(); // ✅ CAMBIO APLICADO — Página creada desde contexto con fingerprint
    await page.setDefaultTimeout(this.timeout);

    const networkEvents: NetworkEvent[] = [];
    const consoleErrors: ConsoleEvent[] = [];
    const requestTimings = new Map<string, number>();

    // Intercept all network requests
    page.on('request', (request: Request) => {
      requestTimings.set(request.url() + request.method(), Date.now());
    });

    page.on('response', (response: Response) => {
      const request = response.request();
      const key = request.url() + request.method();
      const startTime = requestTimings.get(key) || Date.now();

      networkEvents.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        statusText: response.statusText(),
        failed: false,
        failureText: null,
        timing: Date.now() - startTime,
        size: parseInt(response.headers()['content-length'] || '0', 10),
        mimeType: response.headers()['content-type'] || '',
      });
    });

    page.on('requestfailed', (request: Request) => {
      const key = request.url() + request.method();
      const startTime = requestTimings.get(key) || Date.now();

      networkEvents.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: null,
        statusText: '',
        failed: true,
        failureText: request.failure()?.errorText || 'Unknown error',
        timing: Date.now() - startTime,
        size: 0,
        mimeType: '',
      });
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location()?.url || '',
        });
      }
    });

    // Navigate to the page
    const startTime = Date.now();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout,
    });
    const loadTime = Date.now() - startTime;
    const statusCode = response?.status() || 0;

    // Wait for network to settle (but don't fail if it doesn't)
    await page.waitForLoadState('networkidle').catch(() => {});

    // Scroll through the full page to trigger lazy loading
    const scrollData = await this.fullScroll(page);

    // Wait for lazy-loaded content network requests to settle
    await page.waitForTimeout(2000);

    const failedRequests = networkEvents.filter(
      (e) => e.failed || (e.status !== null && e.status >= 400)
    );

    return {
      url,
      statusCode,
      page,
      networkEvents,
      failedRequests,
      consoleErrors,
      loadTime,
      scrollHeight: scrollData.scrollHeight,
      viewportHeight: scrollData.viewportHeight,
    };
  }

  async fullScroll(page: Page): Promise<{ scrollHeight: number; viewportHeight: number }> {
    return page.evaluate(`(async () => {
      const viewportHeight = window.innerHeight;
      let lastHeight = document.body.scrollHeight;
      let position = 0;
      const step = Math.floor(viewportHeight * 0.8);
      let stableCount = 0;

      while (stableCount < 3) {
        position += step;
        window.scrollTo({ top: position, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 400));

        const newHeight = document.body.scrollHeight;
        if (position >= newHeight) {
          if (newHeight === lastHeight) {
            stableCount++;
          } else {
            stableCount = 0;
          }
          lastHeight = newHeight;
        }

        if (position > 50000) break;
      }

      window.scrollTo({ top: 0 });
      await new Promise(r => setTimeout(r, 200));

      return { scrollHeight: document.body.scrollHeight, viewportHeight };
    })()`);
  }

  async close(page: Page): Promise<void> {
    await page.close().catch(() => {});
  }
}
