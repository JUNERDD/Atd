import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, Download, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { detachText320, diagnosticsBreadcrumbs } from './breadcrumbs';
import './diagnostics.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorName: string;
  errorMessage: string;
}

const INITIAL_STATE: ErrorBoundaryState = {
  hasError: false,
  errorName: '',
  errorMessage: '',
};

function ErrorBoundaryFallback({
  errorName,
  errorMessage,
  onRetry,
}: {
  errorName: string;
  errorMessage: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation('diagnostics');
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canExport = Boolean(window.desktop?.diagnostics?.exportBundle);

  async function handleExport() {
    const exportBundle = window.desktop?.diagnostics?.exportBundle;
    if (!exportBundle || exporting) return;
    setExporting(true);
    setFeedback(null);
    try {
      const result = await exportBundle(false);
      setFeedback(
        result.outcome === 'saved'
          ? t('errorBoundary.exported', { fileName: result.fileName })
          : t('errorBoundary.exportCancelled'),
      );
    } catch {
      setFeedback(t('errorBoundary.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="diagnostics-error-surface" role="alert">
      <header className="diagnostics-error-header">
        <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <h1 className="min-w-0 truncate text-sm font-medium text-foreground">
          {t('errorBoundary.title')}
        </h1>
      </header>
      <ScrollArea className="min-h-0 flex-1" scrollShadow>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">{t('errorBoundary.description')}</p>
          {(errorName || errorMessage) && (
            <div className="rounded-2xl border border-border bg-card p-3">
              <p className="font-mono text-xs break-words whitespace-pre-wrap text-foreground">
                {errorName ? `${errorName}: ${errorMessage}` : errorMessage}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              {t('errorBoundary.retry')}
            </Button>
            {canExport && (
              <Button
                type="button"
                variant="outline"
                disabled={exporting}
                onClick={() => void handleExport()}
              >
                <Download data-icon="inline-start" aria-hidden="true" />
                {exporting ? t('errorBoundary.exporting') : t('errorBoundary.export')}
              </Button>
            )}
          </div>
          {feedback && (
            <output className="text-xs text-muted-foreground" aria-live="polite">
              {feedback}
            </output>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Root renderer boundary that keeps the frameless macOS window draggable via
 * `.diagnostics-error-header`, resets on `hashchange` or retry, and offers redacted export.
 */
export class DiagnosticsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const errorName = error instanceof Error ? detachText320(error.name, 64) : 'Error';
    const rawMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return {
      hasError: true,
      errorName,
      errorMessage: detachText320(rawMessage || 'Unexpected rendering error', 320),
    };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    diagnosticsBreadcrumbs.record({
      category: 'error_boundary',
      code: null,
      name: error.name || 'Error',
      message: error.message || 'Render failure',
    });
  }

  override componentDidMount(): void {
    window.addEventListener('hashchange', this.handleHashChange);
  }

  override componentWillUnmount(): void {
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  private readonly handleHashChange = (): void => {
    if (this.state.hasError) this.handleReset();
  };

  private readonly handleReset = (): void => {
    this.setState(INITIAL_STATE);
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorBoundaryFallback
          errorName={this.state.errorName}
          errorMessage={this.state.errorMessage}
          onRetry={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
