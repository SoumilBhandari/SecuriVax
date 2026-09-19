import { Component, type ReactNode } from "react";

import { asset } from "../lib/snapshot";

/** One broken card must never take the verdict down with it. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; page?: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.page) {
      return (
        <div className="mx-auto max-w-xl p-6 text-center">
          <p className="font-display text-xl font-bold">Something went wrong on this page.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => location.reload()} className="rounded-lg bg-ink px-4 text-white">
              Reload
            </button>
            <a href={asset("/")} className="button inline-flex items-center rounded-lg border border-line px-4">
              Home
            </a>
          </div>
        </div>
      );
    }
    return (
      <p role="alert" className="rounded-xl bg-white p-3 text-sm text-muted">
        {this.props.label ?? "This section"} couldn't be shown. The verdict above is unaffected.
      </p>
    );
  }
}
