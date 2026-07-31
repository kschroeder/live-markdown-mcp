import fs from "node:fs";
import type { HubStateFile } from "@markdown-mcp/shared";
import { ensureAppDir, hubLockPath, hubStatePath } from "./paths.js";

export function writeHubState(state: HubStateFile): void {
  ensureAppDir();
  fs.writeFileSync(hubStatePath(), JSON.stringify(state, null, 2), "utf8");
}

export function readHubState(): HubStateFile | null {
  try {
    if (!fs.existsSync(hubStatePath())) return null;
    return JSON.parse(fs.readFileSync(hubStatePath(), "utf8")) as HubStateFile;
  } catch {
    return null;
  }
}

export function clearHubState(): void {
  try {
    if (fs.existsSync(hubStatePath())) fs.unlinkSync(hubStatePath());
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(hubLockPath())) fs.unlinkSync(hubLockPath());
  } catch {
    /* ignore */
  }
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove lock/state if the owning process is gone. */
export function clearStaleLock(): void {
  ensureAppDir();
  try {
    if (fs.existsSync(hubLockPath())) {
      const raw = fs.readFileSync(hubLockPath(), "utf8").trim();
      const pid = Number(raw);
      if (!isPidAlive(pid)) {
        fs.unlinkSync(hubLockPath());
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const state = readHubState();
    if (state && !isPidAlive(state.pid)) {
      if (fs.existsSync(hubStatePath())) fs.unlinkSync(hubStatePath());
    }
  } catch {
    /* ignore */
  }
}

/** Exclusive lock via O_EXCL. Steals lock if previous owner PID is dead. */
export function tryAcquireLock(): boolean {
  ensureAppDir();
  clearStaleLock();
  try {
    const fd = fs.openSync(hubLockPath(), "wx");
    fs.writeFileSync(fd, String(process.pid), "utf8");
    fs.closeSync(fd);
    return true;
  } catch {
    // One more steal attempt if lock appeared stale mid-race
    clearStaleLock();
    try {
      const fd = fs.openSync(hubLockPath(), "wx");
      fs.writeFileSync(fd, String(process.pid), "utf8");
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }
}

export function releaseLock(): void {
  try {
    if (fs.existsSync(hubLockPath())) {
      const pid = fs.readFileSync(hubLockPath(), "utf8").trim();
      if (pid === String(process.pid)) {
        fs.unlinkSync(hubLockPath());
      }
    }
  } catch {
    /* ignore */
  }
}

export async function isHubAlive(state: HubStateFile | null): Promise<boolean> {
  if (!state?.port) return false;
  // Prefer health check — PID can be recycled.
  try {
    const url = `http://${state.host}:${state.port}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}
