/**
 * Helpers for building page.evaluate() JavaScript snippets.
 * All output strings use var/function-only syntax (no const/let/arrow)
 * because they run inside Playwright's browser context where tsx/esbuild's
 * __name helper is not available.
 */

export interface VisibilityOptions {
  includeOpacity?: boolean;
  checkDimensions?: boolean;
}

export function visibilityCheckSnippet(opts: VisibilityOptions = {}): string {
  var includeOpacity = opts.includeOpacity !== false;
  var checkDimensions = opts.checkDimensions === true;

  var parts = [
    "style.display !== 'none'",
    "style.visibility !== 'hidden'",
  ];

  if (includeOpacity) {
    parts.push("parseFloat(style.opacity) > 0");
  }

  if (checkDimensions) {
    parts.push("rect.height > 0");
  }

  return parts.join(' && ');
}

export function imgSrcSelector(src: string): string {
  return 'img[src="' + src.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
}

export function dedupByKey(items: string[], keyFn: (item: string) => string): string[] {
  var seen = new Set<string>();
  var result: string[] = [];
  for (var i = 0; i < items.length; i++) {
    var key = keyFn(items[i]);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(items[i]);
    }
  }
  return result;
}
