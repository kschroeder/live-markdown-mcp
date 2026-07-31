import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import type { AppSettings, HubEvent, HubPublicState } from "@markdown-mcp/shared";
import { FileStore } from "./store.js";
import { PathWatcher } from "./watcher.js";
import { loadSettings, saveSettings, updateSettings } from "./settings.js";
import { openBrowserOnce, resetBrowserFlag } from "./browser.js";
import {
  clearHubState,
  releaseLock,
  tryAcquireLock,
  writeHubState,
} from "./lock.js";

const CLIENT_GRACE_MS = 2000;

export interface HubRuntime {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startHub(options?: {
  host?: string;
  port?: number;
  /** Skip lock (tests). */
  skipLock?: boolean;
}): Promise<HubRuntime> {
  if (!options?.skipLock && !tryAcquireLock()) {
    throw new Error("Another hub holds the lock");
  }

  const settings = loadSettings();
  const host = options?.host ?? settings.bindHost ?? "127.0.0.1";
  const preferredPort = options?.port ?? 0;

  const store = new FileStore(settings);
  resetBrowserFlag();

  const clients = new Map<string, { id: string; lastSeen: number }>();
  const sockets = new Set<WebSocket>();
  let exitTimer: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  const watcher = new PathWatcher(onWatchedFile);

  function broadcast(event: HubEvent): void {
    const data = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  /** Full state push — avoid pairing with file:update on every keystroke path. */
  function broadcastState(): void {
    store.setClientCount(clients.size);
    broadcast({ type: "state", payload: store.publicState() });
  }

  function onWatchedFile(filePath: string, event: "add" | "change" | "unlink"): void {
    if (event === "unlink") {
      const updated = store.refreshFromDisk(filePath, "Deleted");
      if (updated) broadcast({ type: "file:update", payload: updated });
      return;
    }
    const updated = store.refreshFromDisk(
      filePath,
      event === "add" ? "First create" : "Update"
    );
    if (!updated) return;
    void maybeOpenBrowser();
    // Single payload is enough; UI merges file:update without needing full state.
    broadcast({ type: "file:update", payload: updated });
  }

  async function maybeOpenBrowser(): Promise<void> {
    const s = store.getSettings();
    if (!s.openBrowserOnFirstFileEvent) return;
    if (store.getBrowserOpened()) return;
    const opened = await openBrowserOnce(store.publicState().hubUrl || runtimeUrl);
    if (opened) {
      store.setBrowserOpened(true);
      broadcastState();
    }
  }

  function scheduleExitIfEmpty(): void {
    if (clients.size > 0) {
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
      }
      return;
    }
    if (exitTimer) clearTimeout(exitTimer);
    exitTimer = setTimeout(() => {
      if (clients.size === 0 && !shuttingDown) {
        console.log("[markdown-mcp-hub] no MCP clients left; shutting down");
        void shutdown();
      }
    }, CLIENT_GRACE_MS);
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    if (exitTimer) clearTimeout(exitTimer);
    watcher.close();
    for (const ws of sockets) ws.close();
    sockets.clear();
    clearHubState();
    releaseLock();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    process.exit(0);
  }

  const app = new Hono();
  app.use("*", cors({ origin: "*" }));

  app.get("/health", (c) => c.json({ ok: true, pid: process.pid }));

  app.get("/api/state", (c) => {
    store.setClientCount(clients.size);
    return c.json(store.publicState());
  });

  app.get("/api/settings", (c) => c.json(store.getSettings()));

  app.put("/api/settings", async (c) => {
    const body = (await c.req.json()) as Partial<AppSettings>;
    // Non-loopback requires explicit confirm flag from UI
    if (body.bindHost && body.bindHost !== "127.0.0.1" && body.bindHost !== "localhost") {
      const confirm = c.req.header("x-confirm-non-local");
      if (confirm !== "1") {
        return c.json(
          { error: "Non-loopback bind requires confirmation (x-confirm-non-local: 1)" },
          400
        );
      }
    }
    const next = updateSettings({ ...store.getSettings(), ...body });
    store.setSettings(next);
    broadcast({ type: "settings", payload: next });
    broadcastState();
    return c.json(next);
  });

  app.post("/api/scope", async (c) => {
    const body = (await c.req.json()) as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return c.json({ error: "path is required" }, 400);
    }
    const result = store.scope(body.path);
    if (result.error) {
      return c.json({ error: result.error }, 403);
    }
    watcher.watch(result.file.path);
    // If file already exists with content, treat as first event for browser
    if (result.file.exists && result.file.content) {
      void maybeOpenBrowser();
    }
    broadcast({ type: "file:update", payload: result.file });
    broadcastState();
    return c.json({
      ok: true as const,
      path: result.file.path,
      alreadyScoped: result.alreadyScoped,
      file: result.file,
    });
  });

  app.post("/api/unwatch", async (c) => {
    const body = (await c.req.json()) as { path?: string };
    if (!body.path) return c.json({ error: "path is required" }, 400);
    const absolute = path.resolve(body.path);
    watcher.unwatch(absolute);
    const removed = store.unwatch(absolute);
    if (removed) {
      broadcast({ type: "file:removed", payload: { path: absolute } });
      broadcastState();
    }
    return c.json({ ok: true, removed });
  });

  app.get("/api/snapshot", (c) => {
    const filePath = c.req.query("path");
    const id = c.req.query("id");
    if (!filePath || !id) return c.json({ error: "path and id required" }, 400);
    const content = store.getSnapshotContent(filePath, id);
    if (content === null) return c.json({ error: "not found" }, 404);
    return c.json({ path: filePath, id, content });
  });

  app.post("/api/clients/register", async (c) => {
    const id = randomUUID();
    clients.set(id, { id, lastSeen: Date.now() });
    store.setClientCount(clients.size);
    if (exitTimer) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
    broadcast({ type: "clients", payload: { count: clients.size } });
    broadcastState();
    return c.json({
      clientId: id,
      hubUrl: runtimeUrl,
      state: store.publicState(),
    });
  });

  app.post("/api/clients/:id/heartbeat", (c) => {
    const id = c.req.param("id");
    const client = clients.get(id);
    if (!client) return c.json({ error: "unknown client" }, 404);
    client.lastSeen = Date.now();
    return c.json({ ok: true });
  });

  app.delete("/api/clients/:id", (c) => {
    const id = c.req.param("id");
    clients.delete(id);
    store.setClientCount(clients.size);
    broadcast({ type: "clients", payload: { count: clients.size } });
    broadcastState();
    scheduleExitIfEmpty();
    return c.json({ ok: true });
  });

  // Static UI
  const webDist = resolveWebDist();
  app.get("/", async (c) => {
    const index = path.join(webDist, "index.html");
    if (fs.existsSync(index)) {
      return c.html(fs.readFileSync(index, "utf8"));
    }
    return c.html(fallbackHtml());
  });

  app.get("/assets/*", async (c) => {
    const rel = c.req.path.replace(/^\/assets\//, "");
    const file = path.join(webDist, "assets", rel);
    if (!file.startsWith(webDist) || !fs.existsSync(file)) {
      return c.notFound();
    }
    const ext = path.extname(file);
    const types: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    return new Response(fs.readFileSync(file), {
      headers: { "Content-Type": types[ext] || "application/octet-stream" },
    });
  });

  // SPA fallback for client routes
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api") || c.req.path === "/health") {
      return c.notFound();
    }
    const index = path.join(webDist, "index.html");
    if (fs.existsSync(index)) {
      return c.html(fs.readFileSync(index, "utf8"));
    }
    return c.html(fallbackHtml());
  });

  const server: Server = createServer(getRequestListener(app.fetch));
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    sockets.add(ws);
    store.setClientCount(clients.size);
    ws.send(JSON.stringify({ type: "state", payload: store.publicState() } satisfies HubEvent));
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => sockets.delete(ws));
  });

  let runtimeUrl = "";

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, host, () => {
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind server");
  }
  const port = addr.port;
  runtimeUrl = `http://${host}:${port}/`;
  store.setHubUrl(runtimeUrl);

  writeHubState({
    port,
    host,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    url: runtimeUrl,
  });

  console.log(`[markdown-mcp-hub] listening on ${runtimeUrl}`);

  // Drop stale MCP clients (e.g. killed without clean unregister)
  const staleTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, c] of clients) {
      if (now - c.lastSeen > 45_000) {
        clients.delete(id);
        changed = true;
      }
    }
    if (changed) {
      store.setClientCount(clients.size);
      broadcast({ type: "clients", payload: { count: clients.size } });
      broadcastState();
      scheduleExitIfEmpty();
    }
  }, 15_000);
  staleTimer.unref?.();

  const onSignal = () => {
    void shutdown();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return {
    url: runtimeUrl,
    host,
    port,
    close: shutdown,
  };
}

function resolveWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "public"),
    path.join(here, "..", "public"),
    path.join(here, "..", "..", "web", "dist"),
    path.join(process.cwd(), "packages", "web", "dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return candidates[0]!;
}

function fallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>MarkdownMCP</title>
<style>body{font-family:system-ui;padding:2rem;background:#f3efe8;color:#2a2730}
code{background:#fff;padding:2px 6px;border-radius:4px}</style></head>
<body>
<h1>MarkdownMCP Hub</h1>
<p>UI assets not built yet. Run <code>npm run build</code> in the monorepo, then restart the hub.</p>
<p>API is up at <code>/api/state</code> and WebSocket at <code>/ws</code>.</p>
</body></html>`;
}

export type { HubPublicState };
