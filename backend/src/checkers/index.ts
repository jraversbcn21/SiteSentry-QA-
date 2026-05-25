export { BrokenResourcesChecker } from './BrokenResourcesChecker';
export { FailedAPIChecker } from './FailedAPIChecker';
export { InteractivityChecker } from './InteractivityChecker';
export { ContentChecker } from './ContentChecker';
export { LazyLoadChecker } from './LazyLoadChecker';
export { FormModalChecker } from './FormModalChecker';
export { ConsoleErrorChecker } from './ConsoleErrorChecker';
export { PerformanceChecker } from './PerformanceChecker';
export { AccessibilityChecker } from './AccessibilityChecker';

import { BrokenResourcesChecker } from './BrokenResourcesChecker';
import { FailedAPIChecker } from './FailedAPIChecker';
import { InteractivityChecker } from './InteractivityChecker';
import { ContentChecker } from './ContentChecker';
import { LazyLoadChecker } from './LazyLoadChecker';
import { FormModalChecker } from './FormModalChecker';
import { ConsoleErrorChecker } from './ConsoleErrorChecker';
import { PerformanceChecker } from './PerformanceChecker';
import { AccessibilityChecker } from './AccessibilityChecker';

export const checkers = [
  new BrokenResourcesChecker(),
  new FailedAPIChecker(),
  new InteractivityChecker(),
  new ContentChecker(),
  new LazyLoadChecker(),
  new FormModalChecker(),
  new ConsoleErrorChecker(),
  new PerformanceChecker(),
  new AccessibilityChecker(),
];
