import type { AppSettings, HubPublicState, ScopedFileState } from "@markdown-mcp/shared";

export async function fetchState(): Promise<HubPublicState> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`state ${res.status}`);
  return res.json() as Promise<HubPublicState>;
}

export async function saveSettings(
  settings: Partial<AppSettings>,
  opts?: { confirmNonLocal?: boolean }
): Promise<AppSettings> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.confirmNonLocal) headers["x-confirm-non-local"] = "1";
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `settings ${res.status}`);
  }
  return res.json() as Promise<AppSettings>;
}

export async function unwatch(path: string): Promise<void> {
  await fetch("/api/unwatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function fetchSnapshot(
  path: string,
  id: string
): Promise<{ content: string }> {
  const q = new URLSearchParams({ path, id });
  const res = await fetch(`/api/snapshot?${q}`);
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json() as Promise<{ content: string }>;
}

export type WsHandlers = {
  onState: (s: HubPublicState) => void;
  onFileUpdate: (f: ScopedFileState) => void;
  onFileRemoved: (path: string) => void;
  onSettings: (s: AppSettings) => void;
};

export function connectWs(handlers: WsHandlers): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      attempt = 0;
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          payload: unknown;
        };
        if (msg.type === "state") handlers.onState(msg.payload as HubPublicState);
        else if (msg.type === "file:update")
          handlers.onFileUpdate(msg.payload as ScopedFileState);
        else if (msg.type === "file:removed")
          handlers.onFileRemoved((msg.payload as { path: string }).path);
        else if (msg.type === "settings")
          handlers.onSettings(msg.payload as AppSettings);
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      if (closed) return;
      // Back off so a down hub does not spin the tab/event loop.
      const delay = Math.min(10_000, 1000 * 2 ** Math.min(attempt, 3));
      attempt += 1;
      retry = setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}
