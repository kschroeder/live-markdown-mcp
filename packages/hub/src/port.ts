import net from "node:net";
import type { Server } from "node:http";
import { PREFERRED_PORT_MAX, PREFERRED_PORT_MIN } from "@markdown-mcp/shared";

/** How many random high ports to try after the sticky preference fails. */
const FALLBACK_ATTEMPTS = 24;

export function isHighPort(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= PREFERRED_PORT_MIN &&
    port <= PREFERRED_PORT_MAX
  );
}

/** Pick a pseudo-random port in the preferred high range (not cryptographically strong). */
export function randomHighPort(exclude?: Set<number>): number {
  const span = PREFERRED_PORT_MAX - PREFERRED_PORT_MIN + 1;
  for (let i = 0; i < 64; i++) {
    const p = PREFERRED_PORT_MIN + Math.floor(Math.random() * span);
    if (!exclude?.has(p)) return p;
  }
  return PREFERRED_PORT_MIN;
}

/**
 * Build the ordered list of ports to try: sticky first (if valid), then random high ports.
 * Does not include OS-ephemeral `0` — callers may fall back to that themselves.
 */
export function candidatePorts(preferredPort: number | null | undefined): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const push = (p: number) => {
    if (!Number.isInteger(p) || p < 1 || p > 65535 || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  if (preferredPort != null && preferredPort > 0) {
    push(Math.trunc(preferredPort));
  }

  // Prefer staying in the high band even when the sticky value was outside it.
  for (let i = 0; i < FALLBACK_ATTEMPTS; i++) {
    push(randomHighPort(seen));
  }

  return out;
}

export function listenOnPort(
  server: Server,
  host: string,
  port: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      // Defer reject so Node finishes emitting before we try the next port.
      queueMicrotask(() => reject(err));
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind server"));
        return;
      }
      resolve(addr.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(port, host);
    } catch (err) {
      server.off("error", onError);
      server.off("listening", onListening);
      reject(err);
    }
  });
}

/**
 * Try sticky / high ports in order. Returns the bound port.
 * Last resort: listen(0) for an OS-assigned port.
 */
export async function bindHttpServer(
  server: Server,
  host: string,
  preferredPort: number | null | undefined
): Promise<{ port: number; usedPreferred: boolean; changedFromPreferred: boolean }> {
  const preferred =
    preferredPort != null && preferredPort > 0 ? Math.trunc(preferredPort) : null;
  const tried: number[] = [];

  for (const port of candidatePorts(preferred)) {
    tried.push(port);
    try {
      const bound = await listenOnPort(server, host, port);
      return {
        port: bound,
        usedPreferred: preferred != null && bound === preferred,
        changedFromPreferred: preferred != null && bound !== preferred,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EADDRINUSE" || code === "EACCES") {
        // Ensure server is not left half-bound before next attempt.
        await closeQuietly(server);
        continue;
      }
      throw err;
    }
  }

  // Last resort — OS ephemeral port (outside sticky preference).
  const bound = await listenOnPort(server, host, 0);
  return {
    port: bound,
    usedPreferred: false,
    changedFromPreferred: preferred != null && bound !== preferred,
  };
}

function closeQuietly(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/** Probe whether a TCP port accepts connections on host (best-effort free check). */
export async function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}
