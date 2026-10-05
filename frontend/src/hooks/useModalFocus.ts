import { useEffect, type RefObject } from 'react';

export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  restoreTarget: HTMLElement | null,
  ref: RefObject<T | null>,
  initialFocusSelector = 'button',
) {
  useEffect(() => {
    if (!open) {
      restoreTarget?.focus();
      return;
    }
    const root = ref.current;
    root?.querySelector<HTMLElement>(initialFocusSelector)?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = ref.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [open, restoreTarget, ref, initialFocusSelector]);
}
