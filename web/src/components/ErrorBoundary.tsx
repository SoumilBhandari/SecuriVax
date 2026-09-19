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
        <div className="shell pt-16 text-center">
          <p className="m-0 text-xl font-semibold">Something went wrong on this page.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => location.reload()} className="btn-outline">
              Reload
            </button>
            <a href={asset("/")} className="btn-quiet">
              Home
            </a>
          </div>
        </div>
      );
    }
    return (
      <p role="alert" className="m-0 rounded-xl bg-neutral-900 p-3 text-sm text-neutral-400">
        {this.props.label ?? "This section"} couldn't be shown. The verdict above is unaffected.
      </p>
    );
  }
}
