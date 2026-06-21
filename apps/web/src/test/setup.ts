import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom does not implement `matchMedia`; the theme provider reads it on mount.
 * Provide a minimal, light-mode stub so components that render under
 * `ThemeProvider` don't crash.
 */
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
});

/**
 * Global test setup for the web app.
 *  - jest-dom matchers (`toBeInTheDocument`, …) registered against Vitest's expect.
 *  - Unmount React trees + clear mocks between tests so DOM state never leaks.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
