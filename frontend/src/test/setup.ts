import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The Studio tests mount a whole Production read model and walk several canvases. With the
// suite running across parallel worker threads, a UI element that legitimately appears can
// take well over the 1s default that async queries (findBy*/waitFor) allow. The ceiling is
// raised here rather than per-test; no assertion changes, only how long we wait for it.
configure({ asyncUtilTimeout: 5000 });
vi.stubGlobal('confirm', vi.fn(() => true));
// jsdom does not implement scrolling; the native-marketing source scripts call it during render.
Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });

afterEach(() => { cleanup(); localStorage.clear(); });
