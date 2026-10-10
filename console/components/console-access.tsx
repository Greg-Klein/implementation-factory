"use client";

import { useEffect, useState } from "react";
import { Factory } from "./factory";

/** The launcher supplies a token in the fragment, which never reaches HTTP logs. */
export function ConsoleAccess() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  async function pair(value: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/session", { method: "POST", headers: { Authorization: `Bearer ${value}` } });
      if (!response.ok) throw new Error("This access token was refused. Open the console with impl start, or enter its current token.");
      setToken(""); setReady(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The console could not be reached."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const supplied = parameters.get("access");
    if (supplied) { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); void pair(supplied); return; }
    fetch("/api/auth/session").then((response) => { setReady(response.ok); }).catch(() => setError("The console could not be reached.")).finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const check = () => { void fetch("/api/auth/session").then((response) => { if (!cancelled && response.status === 401) { setReady(false); setError("Your session ended. Open the console with impl start to connect again."); } }).catch(() => undefined); };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [ready]);
  if (ready) return <Factory />;
  return <main className="grid min-h-screen place-items-center p-6"><form className="w-full max-w-md space-y-4" onSubmit={(event) => { event.preventDefault(); void pair(token); }}>
    <h1 className="text-xl font-semibold">Connect to Implementation Factory</h1>
    <p className="text-sm">Open the console with <code>impl start</code>, or enter the access token from its local data directory.</p>
    <label className="block text-sm">Access token<input aria-label="Access token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 w-full rounded border p-2" /></label>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <button disabled={busy || !token.trim()} className="rounded border px-4 py-2 disabled:opacity-50">{busy ? "Connecting…" : "Connect"}</button>
  </form></main>;
}
