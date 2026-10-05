import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { AppError, safeError } from '../services/errors';
import type { SaveState } from '../types/domain';

export function useAutosave<T>(initial: T, persist: (value: T) => Promise<void>, delay = 300) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const current = useRef(value);
  const saved = useRef(initial);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  current.current = value;
  const dirty = !Object.is(value, saved.current);
  const flush = useCallback(async () => {
    if (inFlight.current || Object.is(current.current, saved.current)) return;
    if (!navigator.onLine) { setState('offline'); return; }
    const snapshot = current.current;
    inFlight.current = true;
    setState('saving'); setError(null);
    try {
      await persistRef.current(snapshot);
      saved.current = snapshot;
      if (alive.current) {
        setLastSavedAt(new Date());
        setState(Object.is(current.current, snapshot) ? 'saved' : 'dirty');
      }
    } catch (failure) {
      if (alive.current) {
        setError(safeError(failure).message);
        setState(failure instanceof AppError && failure.kind === 'conflict' ? 'conflict' : navigator.onLine ? 'failed' : 'offline');
      }
    } finally { inFlight.current = false; }
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!dirty || state === 'failed' || state === 'conflict' || state === 'offline') return;
    const timer = window.setTimeout(() => { void flush(); }, delay);
    return () => window.clearTimeout(timer);
  }, [value, dirty, state, delay, flush, lastSavedAt]);
  useEffect(() => {
    const offline = () => { if (!Object.is(current.current, saved.current)) setState('offline'); };
    const online = () => { if (!Object.is(current.current, saved.current)) setState(s => s === 'conflict' ? s : 'dirty'); };
    const unload = (event: BeforeUnloadEvent) => { if (!Object.is(current.current, saved.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('offline', offline); window.addEventListener('online', online); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); window.removeEventListener('beforeunload', unload); };
  }, []);
  return { value, setValue: (next: T) => { current.current = next; setValue(next); setState('dirty'); setError(null); }, state, dirty, error, lastSavedAt, retry: () => { void flush(); } };
}
export function useUnsavedNavigation(dirty: boolean) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Your changes are not saved. Leave this production and discard them?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
}
