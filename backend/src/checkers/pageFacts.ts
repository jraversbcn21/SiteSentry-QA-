import { Page } from 'playwright';
import { visibilityCheckSnippet } from './domHelpers';

/**
 * PageFacts (T33/H9): shared single-pass DOM snapshot.
 * One page.evaluate() round-trip collects all DOM fragments that the
 * checkers previously queried independently (16 round-trips total).
 *
 * All browser-side code uses var/function-only syntax (no const/let/arrows)
 * because it runs inside Playwright's browser context where tsx/esbuild's
 * __name helper is not available. Fragment logic is copied verbatim from the
 * original per-checker snippets to preserve detection behavior exactly.
 */

export interface BrokenImageFact {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface EmptyContainerFact {
  selector: string;
  tag: string;
  className: string;
  id: string;
  height: number;
}

export interface ErrorStateFact {
  text: string;
  selector: string;
}

export interface MainContentFact {
  mainHasContent: boolean;
  tag?: string;
  id?: string;
  className?: string;
  selector?: string;
}

export interface CorsCandidateFact {
  url: string;
  duration: number;
}

export interface FormIssueFact {
  id: string;
  action: string;
  inputCount: number;
  issue: string;
}

export interface ModalFact {
  selector: string;
  hasCloseButton: boolean;
  text: string;
}

export interface BlockerFact {
  found: boolean;
  selector?: string;
  height?: number;
  position?: string;
}

export interface DeadButtonFact {
  tag: string;
  text: string;
  hasOnclick: boolean;
  ariaLabel: string;
}

export interface PlaceholderLinkFact {
  text: string;
  href: string;
}

export interface PseudoDisabledFact {
  text: string;
  opacity: string;
  cursor: string;
}

export interface LazyImageFact {
  src: string;
  dataSrc: string;
  width: number;
  height: number;
  alt: string;
}

export interface SpinnerFact {
  selector: string;
  className: string;
}

export interface PlaceholderImageFact {
  src: string;
  displayWidth: number;
  naturalWidth: number;
  alt: string;
}

export interface PerformanceFacts {
  ttfb: number;
  domContentLoaded: number;
  fullLoad: number;
  domNodes: number;
  resourceCount: number;
  totalTransferKB: number;
}

export interface PageFacts {
  brokenImages: BrokenImageFact[];
  backgroundImageUrls: string[];
  emptyContainers: EmptyContainerFact[];
  errorStates: ErrorStateFact[];
  mainContent: MainContentFact;
  corsCandidates: CorsCandidateFact[];
  formIssues: FormIssueFact[];
  modals: ModalFact[];
  cookieBlocker: BlockerFact;
  deadButtons: DeadButtonFact[];
  placeholderLinks: PlaceholderLinkFact[];
  pseudoDisabledButtons: PseudoDisabledFact[];
  lazyImages: LazyImageFact[];
  spinners: SpinnerFact[];
  placeholderImages: PlaceholderImageFact[];
  performance: PerformanceFacts;
}

export async function collectPageFacts(page: Page): Promise<PageFacts> {
  return page.evaluate(`(() => {
    var out = {};

    // --- brokenImages (BrokenResourcesChecker) ---
    var biImgs = Array.from(document.querySelectorAll('img'));
    out.brokenImages = biImgs
      .filter(function(img) {
        if (!img.src || img.src.startsWith('data:')) return false;
        return !img.complete || img.naturalWidth === 0;
      })
      .map(function(img) {
        return { src: img.src, alt: img.alt || '', width: img.width, height: img.height };
      })
      .slice(0, 30);

    // --- backgroundImageUrls (BrokenResourcesChecker) ---
    var bgElements = Array.from(document.querySelectorAll('*'));
    var bgResults = [];
    for (var bgI = 0; bgI < bgElements.length; bgI++) {
      var bg = window.getComputedStyle(bgElements[bgI]).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        var bgMatch = bg.match(/url\\(["']?(.+?)["']?\\)/);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
          bgResults.push(bgMatch[1]);
        }
      }
      if (bgResults.length >= 50) break;
    }
    out.backgroundImageUrls = Array.from(new Set(bgResults));

    // --- emptyContainers (ContentChecker) ---
    var ecSelectors = ['main','[role="main"]','.products','.product-list','.product-grid','.items','.results','.content','.listing','.grid','.cards','.feed','[data-testid]','ul.list','ol.list','section > div'];
    var ecResults = [];
    for (var ecS = 0; ecS < ecSelectors.length; ecS++) {
      var ecElements = document.querySelectorAll(ecSelectors[ecS]);
      for (var ecI = 0; ecI < ecElements.length; ecI++) {
        var ecEl = ecElements[ecI];
        var ecRect = ecEl.getBoundingClientRect();
        var ecStyle = window.getComputedStyle(ecEl);
        if (ecStyle.display === 'none' || ecStyle.visibility === 'hidden') continue;
        var ecChildCount = ecEl.children.length;
        var ecTextLength = (ecEl.textContent || '').trim().length;
        if (ecRect.height > 50 && ecRect.width > 100 && ecChildCount === 0 && ecTextLength === 0) {
          ecResults.push({
            selector: ecSelectors[ecS],
            tag: ecEl.tagName.toLowerCase(),
            className: (ecEl.className && typeof ecEl.className === 'string') ? ecEl.className.substring(0, 60) : '',
            id: ecEl.id || '',
            height: Math.round(ecRect.height)
          });
        }
      }
    }
    out.emptyContainers = ecResults.slice(0, 15);

    // --- errorStates (ContentChecker) ---
    var esSelectors = ['.error','.error-message','[class*="error"]','[class*="Error"]','.alert-danger','.alert-error','[role="alert"]','.no-results','.empty-state','.not-found'];
    var esResults = [];
    for (var esS = 0; esS < esSelectors.length; esS++) {
      try {
        var esElements = document.querySelectorAll(esSelectors[esS]);
        for (var esI = 0; esI < esElements.length; esI++) {
          var esEl = esElements[esI];
          var style = window.getComputedStyle(esEl);
          var esRect = esEl.getBoundingClientRect();
          var esIsVisible = ${visibilityCheckSnippet()} && esRect.height > 0;
          if (esIsVisible) {
            var esText = (esEl.textContent || '').trim().substring(0, 100);
            if (esText.length > 0) esResults.push({ text: esText, selector: esSelectors[esS] });
          }
        }
      } catch(e) {}
    }
    out.errorStates = esResults.slice(0, 10);

    // --- mainContent (ContentChecker) ---
    var mcContainers = document.querySelectorAll('main, [role="main"], .content, #content, #app, #root');
    out.mainContent = (function() {
      if (mcContainers.length === 0) return { mainHasContent: true };
      for (var mcI = 0; mcI < mcContainers.length; mcI++) {
        var mcText = (mcContainers[mcI].textContent || '').trim();
        if (mcText.length < 10) {
          return {
            mainHasContent: false,
            tag: mcContainers[mcI].tagName.toLowerCase(),
            id: mcContainers[mcI].id || '',
            className: (mcContainers[mcI].className && typeof mcContainers[mcI].className === 'string') ? mcContainers[mcI].className.substring(0, 40) : '',
            selector: mcContainers[mcI].id ? '#' + mcContainers[mcI].id : mcContainers[mcI].tagName.toLowerCase()
          };
        }
      }
      return { mainHasContent: true };
    })();

    // --- corsCandidates (FailedAPIChecker) ---
    var ccEntries = performance.getEntriesByType('resource');
    out.corsCandidates = ccEntries
      .filter(function(e) { return e.transferSize === 0 && e.decodedBodySize === 0 && e.duration > 0; })
      .map(function(e) { return { url: e.name, duration: Math.round(e.duration) }; })
      .slice(0, 20);

    // --- formIssues (FormModalChecker) ---
    var fmForms = Array.from(document.querySelectorAll('form'));
    var fmResults = [];
    for (var fmI = 0; fmI < fmForms.length; fmI++) {
      var fmForm = fmForms[fmI];
      var fmRect = fmForm.getBoundingClientRect();
      if (fmRect.height === 0) continue;
      var fmAction = fmForm.getAttribute('action') || '';
      var fmHasSubmit = fmForm.querySelector('button[type="submit"], input[type="submit"]') !== null;
      var fmInputs = fmForm.querySelectorAll('input, textarea, select');
      if (fmInputs.length > 0 && !fmHasSubmit) {
        fmResults.push({ id: fmForm.id || '', action: fmAction, inputCount: fmInputs.length, issue: 'no_submit' });
      }
      if (fmAction === '#' || fmAction === '') {
        var fmHasHandler = fmForm.getAttribute('onsubmit') !== null;
        if (!fmHasHandler) {
          fmResults.push({ id: fmForm.id || '', action: fmAction, inputCount: fmInputs.length, issue: 'no_action' });
        }
      }
    }
    out.formIssues = fmResults.slice(0, 10);

    // --- modals (FormModalChecker) ---
    var mdSelectors = ['[role="dialog"]','.modal','[class*="modal"]','[class*="dialog"]','[class*="popup"]','[class*="overlay"]','dialog'];
    var mdResults = [];
    for (var mdS = 0; mdS < mdSelectors.length; mdS++) {
      try {
        var mdElements = document.querySelectorAll(mdSelectors[mdS]);
        for (var mdI = 0; mdI < mdElements.length; mdI++) {
          var mdEl = mdElements[mdI];
          var style = window.getComputedStyle(mdEl);
          var mdRect = mdEl.getBoundingClientRect();
          var mdIsVisible = ${visibilityCheckSnippet()} && mdRect.height > 100;
          if (!mdIsVisible) continue;
          var mdHasClose = mdEl.querySelector('button[class*="close"], [aria-label="close"], [aria-label="Close"], .close, [class*="dismiss"]') !== null;
          var mdCoversPage = mdRect.width > window.innerWidth * 0.5 && mdRect.height > window.innerHeight * 0.3;
          if (mdCoversPage) {
            mdResults.push({ selector: mdSelectors[mdS], hasCloseButton: mdHasClose, text: (mdEl.textContent || '').trim().substring(0, 80) });
          }
        }
      } catch(e) {}
    }
    out.modals = mdResults.slice(0, 5);

    // --- cookieBlocker (FormModalChecker) ---
    var blSelectors = ['[class*="cookie"]','[class*="consent"]','[class*="gdpr"]','[id*="cookie"]','[id*="consent"]'];
    out.cookieBlocker = (function() {
      for (var blS = 0; blS < blSelectors.length; blS++) {
        try {
          var blElements = document.querySelectorAll(blSelectors[blS]);
          for (var blI = 0; blI < blElements.length; blI++) {
            var blEl = blElements[blI];
            var blStyle = window.getComputedStyle(blEl);
            var blRect = blEl.getBoundingClientRect();
            var blIsVisible = ${visibilityCheckSnippet({ includeOpacity: false })} && blRect.height > 50;
            var blIsFixed = blStyle.position === 'fixed' || blStyle.position === 'sticky';
            var blHasHighZ = parseInt(blStyle.zIndex, 10) > 100;
            if (blIsVisible && (blIsFixed || blHasHighZ)) {
              return { found: true, selector: blSelectors[blS], height: Math.round(blRect.height), position: blStyle.position };
            }
          }
        } catch(e) {}
      }
      return { found: false };
    })();

    // --- deadButtons (InteractivityChecker) ---
    var dbSelectors = 'button:not([disabled]),a[role="button"],input[type="button"],input[type="submit"],[role="button"],[onclick]';
    var dbElements = Array.from(document.querySelectorAll(dbSelectors));
    var dbResults = [];
    for (var dbI = 0; dbI < dbElements.length; dbI++) {
      var dbEl = dbElements[dbI];
      var dbRect = dbEl.getBoundingClientRect();
      if (dbRect.width === 0 || dbRect.height === 0) continue;
      var dbStyle = window.getComputedStyle(dbEl);
      if (dbStyle.visibility === 'hidden' || dbStyle.display === 'none') continue;
      var dbTag = dbEl.tagName.toLowerCase();
      var dbText = (dbEl.textContent || '').trim().substring(0, 50);
      var dbAriaLabel = dbEl.getAttribute('aria-label') || '';
      if (dbTag === 'a' && !dbEl.href) {
        dbResults.push({ tag: dbTag, text: dbText, hasOnclick: !!dbEl.getAttribute('onclick'), ariaLabel: dbAriaLabel });
      }
    }
    out.deadButtons = dbResults.slice(0, 20);

    // --- placeholderLinks (InteractivityChecker) ---
    var plLinks = Array.from(document.querySelectorAll('a[href]'));
    out.placeholderLinks = plLinks
      .filter(function(a) {
        var href = a.getAttribute('href') || '';
        var rect = a.getBoundingClientRect();
        return (href === '#' || href === 'javascript:void(0)' || href === 'javascript:;') && rect.width > 0 && rect.height > 0;
      })
      .map(function(a) {
        return { text: (a.textContent || '').trim().substring(0, 50), href: a.getAttribute('href') || '' };
      })
      .slice(0, 15);

    // --- pseudoDisabledButtons (InteractivityChecker) ---
    var pdButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    out.pseudoDisabledButtons = pdButtons
      .filter(function(btn) {
        var style = window.getComputedStyle(btn);
        var rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        var looksDisabled = parseFloat(style.opacity) < 0.5 || style.cursor === 'not-allowed';
        return looksDisabled && !btn.disabled;
      })
      .map(function(btn) {
        var style = window.getComputedStyle(btn);
        return { text: (btn.textContent || '').trim().substring(0, 50), opacity: style.opacity, cursor: style.cursor };
      })
      .slice(0, 10);

    // --- lazyImages (LazyLoadChecker) ---
    var lzImgs = Array.from(document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy]'));
    out.lazyImages = lzImgs
      .map(function(img) {
        var rect = img.getBoundingClientRect();
        return {
          src: img.src || '',
          dataSrc: img.getAttribute('data-src') || img.getAttribute('data-lazy') || '',
          loaded: img.complete && img.naturalWidth > 0,
          inViewport: rect.top < window.innerHeight * 2,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          alt: img.alt || ''
        };
      })
      .filter(function(img) { return !img.loaded && img.inViewport && (img.width > 0 || img.height > 0); })
      .slice(0, 20);

    // --- spinners (LazyLoadChecker) ---
    var spSelectors = ['.spinner','.loading','[class*="spinner"]','[class*="loading"]','[class*="loader"]','[aria-busy="true"]','.skeleton','[class*="skeleton"]','[class*="placeholder"]'];
    var spResults = [];
    for (var spS = 0; spS < spSelectors.length; spS++) {
      try {
        var spElements = document.querySelectorAll(spSelectors[spS]);
        for (var spI = 0; spI < spElements.length; spI++) {
          var spEl = spElements[spI];
          var spRect = spEl.getBoundingClientRect();
          var style = window.getComputedStyle(spEl);
          var spIsVisible = spRect.height > 0 && ${visibilityCheckSnippet()};
          if (spIsVisible) {
            spResults.push({
              selector: spSelectors[spS],
              className: (spEl.className && typeof spEl.className === 'string') ? spEl.className.substring(0, 60) : ''
            });
          }
        }
      } catch(e) {}
    }
    out.spinners = spResults.slice(0, 5);

    // --- placeholderImages (LazyLoadChecker) ---
    var phImgs = Array.from(document.querySelectorAll('img'));
    out.placeholderImages = phImgs
      .filter(function(img) {
        var rect = img.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return false;
        return img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2 && rect.width > 50;
      })
      .map(function(img) {
        return { src: img.src, displayWidth: Math.round(img.getBoundingClientRect().width), naturalWidth: img.naturalWidth, alt: img.alt || '' };
      })
      .slice(0, 15);

    // --- performance (PerformanceChecker) ---
    var pfT = performance.timing;
    var pfNav = performance.getEntriesByType('navigation')[0];
    var pfResources = performance.getEntriesByType('resource');
    var pfTotalBytes = pfResources.reduce(function(sum, r) { return sum + (r.transferSize || 0); }, 0);
    var pfNavStart = pfT.navigationStart;
    out.performance = {
      ttfb: pfT.responseStart > pfNavStart ? pfT.responseStart - pfNavStart : 0,
      domContentLoaded: pfT.domContentLoadedEventEnd > pfNavStart ? pfT.domContentLoadedEventEnd - pfNavStart : 0,
      fullLoad: pfT.loadEventEnd > pfNavStart ? pfT.loadEventEnd - pfNavStart : 0,
      domNodes: document.querySelectorAll('*').length,
      resourceCount: pfResources.length,
      totalTransferKB: Math.round(pfTotalBytes / 1024)
    };

    return out;
  })()`);
}
