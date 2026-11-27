import { Component, type ErrorInfo, type ReactNode } from 'react';

interface PageErrorBoundaryProps {
  className: string;
  fallbackMessage: string;
  onError(error: Error): void;
  children: ReactNode;
}

interface PageErrorBoundaryState {
  failed: boolean;
}

/**
 * Lightweight React error boundary for extension UI pages (panel and options). Reports render
 * crashes to the service worker's flight recorder and renders a minimal fallback without hooks
 * or external dependencies.
 */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  override state: PageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className={this.props.className} role="alert">
          <p>{this.props.fallbackMessage}</p>
        </main>
      );
    }
    return this.props.children;
  }
}
