// Top-level safety net: any error thrown while the app starts or renders shows
// a readable message instead of a blank white page.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App startup/render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isConfig = /supabaseUrl|supabaseKey|is required/i.test(error.message ?? '');

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              The Nyamira National Polytechnic
            </p>
            <h1 className="text-lg font-semibold">
              {isConfig ? 'Portal configuration issue' : 'Something went wrong'}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isConfig
              ? 'The portal could not connect to its backend. Please refresh the page — if this continues, contact the system administrator.'
              : 'The portal hit an unexpected error while loading. Refreshing usually resolves it.'}
          </p>
          <p className="text-xs text-muted-foreground break-words">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Refresh and try again
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
