import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Per-widget error isolation. A render error in one widget (e.g. a malformed
 * config, or a renderer bug) is caught here so it shows a small inline notice
 * instead of blanking the whole dashboard. Query/network failures are handled by
 * each widget's own error state; this catches the synchronous render path.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced inline; logged for diagnostics without crashing the grid.
    console.error('Widget render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-4 py-6 text-center"
        >
          <AlertTriangle className="size-5 text-severity-warning" strokeWidth={1.75} aria-hidden />
          <p className="text-xs text-muted-foreground">This widget couldn’t be displayed.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
