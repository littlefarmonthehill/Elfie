import { Component, type ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Patterns that indicate a stale JS bundle from a new deployment (not a real code bug).
// These should auto-reload rather than showing the error boundary.
const STALE_BUNDLE_PATTERNS = [
  /is not a constructor/i,
  /is not a function/i,
  /failed to fetch dynamically imported module/i,
  /loading chunk \d+ failed/i,
  /cannot read propert(?:y|ies) of undefined/i,
];

function isStaleDeploymentError(err: Error | null): boolean {
  if (!err) return false;
  return STALE_BUNDLE_PATTERNS.some(p => p.test(err.message));
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    // Auto-reload for errors that look like a stale deployment bundle.
    // Give the page 800 ms so the service worker can pick up the new version.
    if (isStaleDeploymentError(error)) {
      setTimeout(() => window.location.reload(), 800);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const isStale = isStaleDeploymentError(this.state.error);
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${isStale ? 'bg-blue-500/10' : 'bg-red-500/10'}`}>
              <RefreshCcw className={`h-8 w-8 ${isStale ? 'text-blue-400 animate-spin' : 'text-red-400'}`} />
            </div>
            <h2 className="text-lg font-semibold text-white">
              {isStale ? 'Loading update…' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-gray-400">
              {isStale
                ? 'A new version is available. Reloading automatically…'
                : 'An unexpected error occurred. Try refreshing the page.'}
            </p>
            {!isStale && this.state.error && (
              <p className="text-xs text-gray-600 bg-gray-800/50 rounded p-2 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
            {!isStale && (
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" onClick={this.handleReset} data-testid="button-error-retry">
                  Try Again
                </Button>
                <Button onClick={this.handleReload} data-testid="button-error-reload">
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Reload Page
                </Button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
