import { chromium, Browser, Page } from 'playwright';
import { collectPageFacts, PageFacts } from '../checkers/pageFacts';
import { BrokenResourcesChecker } from '../checkers/BrokenResourcesChecker';
import { LazyLoadChecker } from '../checkers/LazyLoadChecker';
import { runCheckers } from '../services/CheckerRunner';
import { IChecker } from '../types';
import { NetworkEvent } from '../analyzer/PageAnalyzer';

var TEST_URL = 'https://test.example.com';

function buildFixture(): PageFacts {
  return {
    brokenImages: [{ src: 'https://test.example.com/img.png', alt: 'alt text', width: 10, height: 10 }],
    backgroundImageUrls: ['https://test.example.com/bg.png'],
    emptyContainers: [],
    errorStates: [{ text: 'Error', selector: '.error' }],
    mainContent: { mainHasContent: true },
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
    performance: { ttfb: 100, domContentLoaded: 200, fullLoad: 300, domNodes: 10, resourceCount: 5, totalTransferKB: 1 },
  };
}

describe('PageFacts — pre-pass DOM de una sola pasada (T33/H9)', () => {
  jest.setTimeout(30000);

  describe('collectPageFacts', () => {
    it('hace exactamente una llamada a page.evaluate y devuelve todos los fragmentos', async () => {
      var fixture = buildFixture();
      var evaluateMock = jest.fn().mockResolvedValue(fixture);
      var fakePage = { evaluate: evaluateMock } as unknown as Page;

      var facts = await collectPageFacts(fakePage);

      expect(evaluateMock).toHaveBeenCalledTimes(1);
      expect(facts).toEqual(fixture);
    });

    it('en un navegador real recolecta todos los fragmentos en una sola evaluacion', async () => {
      var browser: Browser = await chromium.launch({ headless: true });
      var page = await browser.newPage();
      try {
        await page.setContent(`
          <html><body>
            <main style="min-height: 100px; min-width: 200px;"></main>
            <form><input type="text" name="q"></form>
            <div class="spinner" style="width:50px;height:50px;"></div>
            <a role="button">Sin destino</a>
            <div class="error" role="alert">Error visible</div>
          </body></html>
        `);
        await page.waitForTimeout(200);

        var evaluateSpy = jest.spyOn(page, 'evaluate');
        var facts = await collectPageFacts(page);

        expect(evaluateSpy).toHaveBeenCalledTimes(1);
        expect(facts.emptyContainers.length).toBeGreaterThan(0);
        expect(facts.formIssues.some(function(f: any) { return f.issue === 'no_submit'; })).toBe(true);
        expect(facts.spinners.length).toBeGreaterThan(0);
        expect(facts.deadButtons.length).toBeGreaterThan(0);
        expect(facts.errorStates.length).toBeGreaterThan(0);
        expect(facts.performance.domNodes).toBeGreaterThan(0);
        expect(facts.mainContent.mainHasContent).toBe(false);
      } finally {
        await page.close();
        await browser.close();
      }
    });
  });

  describe('checkers consumen facts sin llamar page.evaluate', () => {
    it('BrokenResourcesChecker usa facts.brokenImages y facts.backgroundImageUrls', async () => {
      var evaluateMock = jest.fn().mockRejectedValue(new Error('no debe llamar evaluate cuando se pasan facts'));
      var fakePage = { evaluate: evaluateMock } as unknown as Page;

      var networkEvents: NetworkEvent[] = [
        { url: 'https://test.example.com/broken.js', method: 'GET', resourceType: 'script', status: 404, statusText: 'Not Found', failed: false, failureText: null, timing: 100, size: 0, mimeType: 'application/javascript' },
      ];
      var facts = buildFixture();
      facts.brokenImages = [];
      facts.backgroundImageUrls = [];

      var issues = await new BrokenResourcesChecker().check(TEST_URL, fakePage, networkEvents, [], facts);

      expect(evaluateMock).not.toHaveBeenCalled();
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('BROKEN_RESOURCE');
      expect(issues[0].severity).toBe('HIGH');
    });

    it('LazyLoadChecker usa facts.spinners y facts.lazyImages', async () => {
      var evaluateMock = jest.fn().mockRejectedValue(new Error('no debe llamar evaluate cuando se pasan facts'));
      var fakePage = { evaluate: evaluateMock } as unknown as Page;

      var facts = buildFixture();
      facts.spinners = [{ selector: '.spinner', className: 'spinner' }];
      facts.lazyImages = [];
      facts.placeholderImages = [];

      var issues = await new LazyLoadChecker().check(TEST_URL, fakePage, [], [], facts);

      expect(evaluateMock).not.toHaveBeenCalled();
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('LAZY_LOAD');
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[0].description.indexOf('atascado') >= 0).toBe(true);
    });

    it('los checkers recolectan facts por si solos cuando no se los pasan (fallback)', async () => {
      var fixture = buildFixture();
      fixture.spinners = [{ selector: '.spinner', className: 'spinner' }];
      fixture.lazyImages = [];
      fixture.placeholderImages = [];
      var evaluateMock = jest.fn().mockResolvedValue(fixture);
      var fakePage = { evaluate: evaluateMock } as unknown as Page;

      var issues = await new LazyLoadChecker().check(TEST_URL, fakePage, []);

      expect(evaluateMock).toHaveBeenCalledTimes(1);
      expect(issues.length).toBe(1);
    });
  });

  describe('runCheckers comparte un unico PageFacts entre todos los checkers', () => {
    it('recolecta facts una vez y se los pasa a cada checker', async () => {
      var fixture = buildFixture();
      fixture.lazyImages = [];
      fixture.placeholderImages = [];
      var evaluateMock = jest.fn().mockResolvedValue(fixture);
      var fakePage = { evaluate: evaluateMock } as unknown as Page;

      var receivedFacts: Array<unknown> = [];
      var fakeChecker: IChecker = {
        name: 'FakeChecker',
        check: async function(_url: string, _page: Page, _events: NetworkEvent[], _consoleErrors?: unknown, facts?: unknown) {
          receivedFacts.push(facts);
          return [];
        },
      };

      await runCheckers([new LazyLoadChecker(), fakeChecker, new LazyLoadChecker()], TEST_URL, fakePage, []);

      expect(evaluateMock).toHaveBeenCalledTimes(1);
      expect(receivedFacts.length).toBe(1);
      expect(receivedFacts[0]).toBe(fixture);
    });
  });
});
