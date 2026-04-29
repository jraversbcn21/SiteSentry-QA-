export { BrokenResourcesChecker } from './BrokenResourcesChecker';
export { FailedAPIChecker } from './FailedAPIChecker';
export { InteractivityChecker } from './InteractivityChecker';
export { ContentChecker } from './ContentChecker';
export { LazyLoadChecker } from './LazyLoadChecker';
export { FormModalChecker } from './FormModalChecker';

import { BrokenResourcesChecker } from './BrokenResourcesChecker';
import { FailedAPIChecker } from './FailedAPIChecker';
import { InteractivityChecker } from './InteractivityChecker';
import { ContentChecker } from './ContentChecker';
import { LazyLoadChecker } from './LazyLoadChecker';
import { FormModalChecker } from './FormModalChecker';

export const checkers = [
  new BrokenResourcesChecker(),
  new FailedAPIChecker(),
  new InteractivityChecker(),
  new ContentChecker(),
  new LazyLoadChecker(),
  new FormModalChecker(),
];
