import type { FlowStep } from '../types';

const GOTO_RE = /page\.goto\(['"]([^'"]+)['"]\)/g;
const CLICK_RE = /page\.click\(['"]([^'"]+)['"]\)/g;
const FILL_RE = /page\.fill\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;
const WAIT_RE = /page\.waitForTimeout\((\d+)\)/g;
const SELECTOPTION_RE = /page\.selectOption\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;
const HOVER_RE = /page\.hover\(['"]([^'"]+)['"]\)/g;
const PRESS_RE = /page\.press\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;

export function parseCodegenScript(script: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const lines = script.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('const ') || line.startsWith('(async')) continue;

    let match: RegExpExecArray | null;

    GOTO_RE.lastIndex = 0;
    if ((match = GOTO_RE.exec(line)) !== null) {
      steps.push({ action: 'navigate', url: match[1] });
      continue;
    }

    CLICK_RE.lastIndex = 0;
    if ((match = CLICK_RE.exec(line)) !== null) {
      steps.push({ action: 'click', selector: match[1] });
      continue;
    }

    FILL_RE.lastIndex = 0;
    if ((match = FILL_RE.exec(line)) !== null) {
      steps.push({ action: 'type', selector: match[1], value: match[2] });
      continue;
    }

    WAIT_RE.lastIndex = 0;
    if ((match = WAIT_RE.exec(line)) !== null) {
      steps.push({ action: 'wait', ms: parseInt(match[1], 10) });
      continue;
    }

    SELECTOPTION_RE.lastIndex = 0;
    if ((match = SELECTOPTION_RE.exec(line)) !== null) {
      steps.push({ action: 'select', selector: match[1], value: match[2] });
      continue;
    }

    HOVER_RE.lastIndex = 0;
    if ((match = HOVER_RE.exec(line)) !== null) {
      steps.push({ action: 'hover', selector: match[1] });
      continue;
    }

    PRESS_RE.lastIndex = 0;
    if ((match = PRESS_RE.exec(line)) !== null) {
      steps.push({ action: 'press', selector: match[1], key: match[2] });
      continue;
    }
  }

  if (steps.length > 0) {
    steps.push({ action: 'checkpoint' });
  }

  return steps;
}
