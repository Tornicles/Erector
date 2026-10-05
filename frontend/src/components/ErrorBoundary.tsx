import { Component, type ErrorInfo, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    console.error('TONDE rendering failure. Reload to recover.');
  }
  render() {
    if (this.state.failed) return <main className="state" role="alert"><h1>TONDE couldn’t display this screen.</h1><p>Your persisted production is not affected.</p><button onClick={() => window.location.reload()}>Reload TONDE</button></main>;
    return this.props.children;
  }
}
