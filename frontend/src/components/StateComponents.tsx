import type { ReactNode } from 'react';
export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  return <div className="state" role="status"><span className="spinner" aria-hidden="true" /><p>{label}</p></div>;
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="state"><h2>{title}</h2><div className="state-description">{children}</div>{action}</section>;
}
// Partial success stays truthful: explain what is known, what is missing and why (INV-16, INV-28).
export function PartialState({ title = 'Partially available', children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="state" role="status"><h2>{title}</h2><div className="state-description">{children}</div>{action}</section>;
}
export function ErrorState({ message, retry, title = 'Something needs attention', cause }: { message: string; retry?: () => void; title?: string; cause?: string }) {
  return <section className="state" role="alert"><h2>{title}</h2><p>{message}</p>{cause && <p className="subtle">{cause}</p>}{retry && <button onClick={retry}>Try again</button>}</section>;
}
