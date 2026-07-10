import { IssueSeverity } from '../types';

export function fixedSeverity(severity: IssueSeverity): IssueSeverity {
  return severity;
}

export function thresholdLadder(
  value: number,
  thresholds: { high?: number; medium?: number; low?: number }
): IssueSeverity {
  if (thresholds.high !== undefined && value > thresholds.high) return IssueSeverity.HIGH;
  if (thresholds.medium !== undefined && value > thresholds.medium) return IssueSeverity.MEDIUM;
  if (thresholds.low !== undefined && value > thresholds.low) return IssueSeverity.LOW;
  return IssueSeverity.LOW;
}

export function mapBy<T extends string>(lookupTable: Record<string, IssueSeverity>, fallback: IssueSeverity): (key: T | undefined | null) => IssueSeverity {
  return function(key: T | undefined | null): IssueSeverity {
    if (key && lookupTable[key]) return lookupTable[key];
    return fallback;
  };
}

export function patternSeverity(text: string, highPatterns: string[], defaultSeverity?: IssueSeverity): IssueSeverity {
  var defaultSev = defaultSeverity || IssueSeverity.MEDIUM;
  for (var i = 0; i < highPatterns.length; i++) {
    if (text.includes(highPatterns[i])) return IssueSeverity.HIGH;
  }
  return defaultSev;
}
