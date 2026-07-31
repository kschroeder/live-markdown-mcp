import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { normalizePath } from "./paths.js";

export type WatchHandler = (filePath: string, event: "add" | "change" | "unlink") => void;

/**
 * Watches individual files with native FS events (no polling by default).
 * Not-yet-created paths: watch parent dir with depth 0 until the file appears.
 */
export class PathWatcher {
  private fileWatcher: FSWatcher | null = null;
  private dirWatcher: FSWatcher | null = null;
  /** normalized path -> absolute path (original casing) */
  private watched = new Map<string, string>();
  /** normalized parent dir -> set of normalized file paths awaiting create */
  private pendingByDir = new Map<string, Set<string>>();
  private onEvent: WatchHandler;
  private debounce = new Map<string, NodeJS.Timeout>();

  constructor(onEvent: WatchHandler) {
    this.onEvent = onEvent;
  }

  watch(filePath: string): void {
    const absolute = path.resolve(filePath);
    const key = normalizePath(absolute);
    if (this.watched.has(key)) return;
    this.watched.set(key, absolute);

    const exists = fs.existsSync(absolute);

    if (exists) {
      this.ensureFileWatcher();
      void this.fileWatcher!.add(absolute);
      return;
    }

    // File does not exist yet — watch parent directory only (non-recursive).
    const parent = path.dirname(absolute);
    const parentKey = normalizePath(parent);
    let set = this.pendingByDir.get(parentKey);
    if (!set) {
      set = new Set();
      this.pendingByDir.set(parentKey, set);
      this.ensureDirWatcher();
      void this.dirWatcher!.add(parent);
    }
    set.add(key);
  }

  unwatch(filePath: string): void {
    const absolute = path.resolve(filePath);
    const key = normalizePath(absolute);
    if (!this.watched.has(key)) return;
    this.watched.delete(key);
    void this.fileWatcher?.unwatch(absolute);

    const parentKey = normalizePath(path.dirname(absolute));
    const set = this.pendingByDir.get(parentKey);
    if (set) {
      set.delete(key);
      if (set.size === 0) {
        this.pendingByDir.delete(parentKey);
        void this.dirWatcher?.unwatch(path.dirname(absolute));
      }
    }
  }

  close(): void {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    void this.fileWatcher?.close();
    void this.dirWatcher?.close();
    this.fileWatcher = null;
    this.dirWatcher = null;
    this.watched.clear();
    this.pendingByDir.clear();
  }

  private watcherOpts() {
    // Polling burns CPU on Windows; only enable via env for flaky network drives.
    const usePolling = process.env.MARKDOWN_MCP_POLL === "1";
    return {
      ignoreInitial: true,
      persistent: true,
      // Prefer native events. awaitWriteFinish without polling uses FS events + delay.
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: usePolling ? 200 : 100,
      },
      usePolling,
      interval: usePolling ? 1000 : undefined,
      binaryInterval: usePolling ? 1000 : undefined,
      // Never recurse into trees — we only watch explicit files / one parent dir.
      depth: 0,
      ignorePermissionErrors: true,
    } as const;
  }

  private ensureFileWatcher(): void {
    if (this.fileWatcher) return;
    this.fileWatcher = chokidar.watch([], this.watcherOpts());
    this.fileWatcher.on("add", (p) => this.emit(p, "add"));
    this.fileWatcher.on("change", (p) => this.emit(p, "change"));
    this.fileWatcher.on("unlink", (p) => this.emit(p, "unlink"));
    this.fileWatcher.on("error", (err) => {
      console.error("[markdown-mcp-hub] file watcher error:", err);
    });
  }

  private ensureDirWatcher(): void {
    if (this.dirWatcher) return;
    this.dirWatcher = chokidar.watch([], this.watcherOpts());
    this.dirWatcher.on("add", (p) => this.onDirEvent(p, "add"));
    this.dirWatcher.on("change", (p) => this.onDirEvent(p, "change"));
    this.dirWatcher.on("unlink", (p) => this.onDirEvent(p, "unlink"));
    this.dirWatcher.on("error", (err) => {
      console.error("[markdown-mcp-hub] dir watcher error:", err);
    });
  }

  private onDirEvent(p: string, event: "add" | "change" | "unlink"): void {
    const absolute = path.resolve(p);
    const key = normalizePath(absolute);
    // Only care about files we are waiting for (or already track under this dir).
    if (!this.watched.has(key)) return;

    if (event === "add" || event === "change") {
      // Promote to file watcher once it exists
      this.ensureFileWatcher();
      void this.fileWatcher!.add(absolute);
      const parentKey = normalizePath(path.dirname(absolute));
      const set = this.pendingByDir.get(parentKey);
      set?.delete(key);
      if (set && set.size === 0) {
        this.pendingByDir.delete(parentKey);
        void this.dirWatcher?.unwatch(path.dirname(absolute));
      }
    }
    this.emit(absolute, event);
  }

  private emit(p: string, event: "add" | "change" | "unlink"): void {
    const absolute = path.resolve(p);
    const key = normalizePath(absolute);
    if (!this.watched.has(key)) return;

    const original = this.watched.get(key) ?? absolute;
    const existing = this.debounce.get(key);
    if (existing) clearTimeout(existing);
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        this.onEvent(original, event);
      }, 100)
    );
  }
}
