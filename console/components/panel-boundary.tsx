"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { Component, type ReactNode } from "react";

type Props = { name: string; resetKey?: string | null; children: ReactNode };
type State = { error?: Error; resetKey?: string | null };

/**
 * A panel that throws while rendering says so in its own place. Without this,
 * React unmounts the whole page for one value a panel did not expect, and the
 * list of runs, the terminal and the other tabs go with it. `resetKey` is the
 * run on screen: what broke on one run says nothing about the next.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: undefined, resetKey: props.resetKey };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="m-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
        <WarningCircleIcon className="mt-0.5 shrink-0" size={14} weight="fill" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium">The {this.props.name} tab could not be displayed.</p>
          <p className="mt-0.5 text-[11px] leading-relaxed">The other tabs and the rest of the console still work.</p>
          <p className="mt-1 break-words font-mono text-[10px]">{error.message}</p>
          <button type="button" onClick={() => this.setState({ error: undefined })} className="mt-1 rounded-md text-[11px] font-medium underline underline-offset-2">Try again</button>
        </div>
      </div>
    );
  }
}
