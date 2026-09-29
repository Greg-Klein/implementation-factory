"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type TerminalHandle = { write: (data: string) => void; clear: () => void };

export const TerminalPanel = forwardRef<TerminalHandle, {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}>(function TerminalPanel({ onInput, onResize }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  /**
   * Read through a ref rather than closed over: the terminal holds everything
   * the run has printed and nothing replays it, so rebuilding it because the
   * parent passed a new callback identity would leave an empty screen fed only
   * with the redraws of a full-screen UI, which land as scattered fragments.
   */
  const callbacks = useRef({ onInput, onResize });
  useEffect(() => { callbacks.current = { onInput, onResize }; });

  /**
   * The handle is attached before the effect below creates the terminal, and
   * the output replayed on opening a run lands in that gap: kept here and
   * written once the terminal exists, instead of being dropped.
   */
  const pendingRef = useRef("");

  useImperativeHandle(ref, () => ({
    write: (data) => {
      if (terminalRef.current) terminalRef.current.write(data);
      else pendingRef.current += data;
    },
    clear: () => {
      pendingRef.current = "";
      terminalRef.current?.clear();
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const fit = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.38,
      scrollback: 8_000,
      allowTransparency: true,
      theme: {
        background: "#191d1b", foreground: "#dfe5df", cursor: "#85ad97",
        selectionBackground: "#3c5c4c", black: "#252a27", brightBlack: "#606963",
        green: "#79a48d", brightGreen: "#9ac1ab", yellow: "#c6ad75", brightYellow: "#d8c48e",
        blue: "#87a7b4", brightBlue: "#a4c2cc", red: "#c77f79", brightRed: "#dc9892",
        white: "#dfe5df", brightWhite: "#f5f8f5",
      },
    });
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    if (pendingRef.current) { terminal.write(pendingRef.current); pendingRef.current = ""; }
    const inputDisposable = terminal.onData((data) => callbacks.current.onInput(data));
    // A hidden tab has no box to measure: fitting there keeps the default 80x24
    // and would shrink the agent's pseudo-terminal away from the size it runs at.
    let laidOut = false;
    const resize = () => {
      if (!containerRef.current?.clientWidth) { laidOut = false; return; }
      fit.fit();
      callbacks.current.onResize(terminal.cols, terminal.rows);
      if (!laidOut) { laidOut = true; terminal.focus(); }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    requestAnimationFrame(resize);
    return () => { observer.disconnect(); inputDisposable.dispose(); terminal.dispose(); terminalRef.current = null; };
  }, []);

  return <div ref={containerRef} className="h-[calc(100%-48px)] min-h-[492px] w-full" aria-label="Terminal Claude Code" />;
});
