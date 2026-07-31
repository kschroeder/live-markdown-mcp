import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppSettings,
  DiffHunk,
  HubPublicState,
  ScopedFileState,
  SnapshotMeta,
} from "@markdown-mcp/shared";
import { computeHunks, hunkStats } from "./diff.js";
import { displayName, isPathAllowed, normalizePath } from "./paths.js";

interface SnapshotRecord extends SnapshotMeta {
  content: string;
}

interface InternalFile {
  path: string;
  snapshots: SnapshotRecord[];
  currentSnapshotId: string | null;
  hunks: DiffHunk[];
  exists: boolean;
  mtimeMs: number | null;
  updatedAt: string;
}

export class FileStore {
  private files = new Map<string, InternalFile>();
  private settings: AppSettings;
  private hubUrl = "";
  private clientCount = 0;
  private browserOpened = false;

  constructor(settings: AppSettings) {
    this.settings = settings;
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  setHubUrl(url: string): void {
    this.hubUrl = url;
  }

  setClientCount(n: number): void {
    this.clientCount = n;
  }

  setBrowserOpened(v: boolean): void {
    this.browserOpened = v;
  }

  getBrowserOpened(): boolean {
    return this.browserOpened;
  }

  hasFiles(): boolean {
    return this.files.size > 0;
  }

  listKeys(): string[] {
    return [...this.files.keys()];
  }

  get(filePath: string): ScopedFileState | undefined {
    const key = normalizePath(filePath);
    const f = this.files.get(key);
    return f ? this.toPublic(f) : undefined;
  }

  isScoped(filePath: string): boolean {
    return this.files.has(normalizePath(filePath));
  }

  scope(filePath: string): { file: ScopedFileState; alreadyScoped: boolean; error?: string } {
    const absolute = path.resolve(filePath);
    if (!isPathAllowed(absolute, this.settings.allowedRoots)) {
      return {
        file: this.emptyPublic(absolute),
        alreadyScoped: false,
        error: `Path is outside allowed roots: ${absolute}`,
      };
    }

    const key = normalizePath(absolute);
    if (this.files.has(key)) {
      return { file: this.toPublic(this.files.get(key)!), alreadyScoped: true };
    }

    const internal: InternalFile = {
      path: absolute,
      snapshots: [],
      currentSnapshotId: null,
      hunks: [],
      exists: false,
      mtimeMs: null,
      updatedAt: new Date().toISOString(),
    };

    this.files.set(key, internal);
    this.readAndSnapshot(key, "Scoped");
    return { file: this.toPublic(this.files.get(key)!), alreadyScoped: false };
  }

  unwatch(filePath: string): boolean {
    const key = normalizePath(filePath);
    return this.files.delete(key);
  }

  /** Re-read from disk and create snapshot if content changed. */
  refreshFromDisk(filePath: string, label = "Update"): ScopedFileState | undefined {
    const key = normalizePath(filePath);
    if (!this.files.has(key)) return undefined;
    this.readAndSnapshot(key, label);
    return this.toPublic(this.files.get(key)!);
  }

  getSnapshotContent(filePath: string, snapshotId: string): string | null {
    const f = this.files.get(normalizePath(filePath));
    if (!f) return null;
    return f.snapshots.find((s) => s.id === snapshotId)?.content ?? null;
  }

  publicState(): HubPublicState {
    return {
      files: [...this.files.values()].map((f) => this.toPublic(f)),
      clientCount: this.clientCount,
      browserOpened: this.browserOpened,
      settings: this.settings,
      hubUrl: this.hubUrl,
    };
  }

  private readAndSnapshot(key: string, label: string): void {
    const f = this.files.get(key)!;
    let content = "";
    let exists = false;
    let mtimeMs: number | null = null;

    try {
      if (fs.existsSync(f.path) && fs.statSync(f.path).isFile()) {
        const st = fs.statSync(f.path);
        content = fs.readFileSync(f.path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        exists = true;
        mtimeMs = st.mtimeMs;
      }
    } catch {
      exists = false;
    }

    const prev = f.snapshots.length ? f.snapshots[f.snapshots.length - 1]! : null;
    if (prev && prev.content === content && f.exists === exists) {
      f.mtimeMs = mtimeMs;
      f.updatedAt = new Date().toISOString();
      return;
    }

    const oldContent = prev?.content ?? "";
    const hunks = prev ? computeHunks(oldContent, content) : computeHunks("", content);
    const stats = hunkStats(hunks);

    const snap: SnapshotRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      label: prev ? label : "First create",
      byteLength: Buffer.byteLength(content, "utf8"),
      stats: prev ? stats : { add: content ? content.split(/\r?\n/).length : 0, del: 0, mod: 0 },
      content,
    };

    f.snapshots.push(snap);
    const limit = this.settings.historyLimit || 50;
    if (f.snapshots.length > limit) {
      f.snapshots = f.snapshots.slice(-limit);
    }
    f.currentSnapshotId = snap.id;
    f.hunks = hunks;
    f.exists = exists;
    f.mtimeMs = mtimeMs;
    f.updatedAt = snap.createdAt;
  }

  private toPublic(f: InternalFile): ScopedFileState {
    const current = f.snapshots.find((s) => s.id === f.currentSnapshotId);
    return {
      path: f.path,
      name: displayName(f.path),
      exists: f.exists,
      content: current?.content ?? "",
      mtimeMs: f.mtimeMs,
      snapshots: f.snapshots.map(({ content: _c, ...meta }) => meta),
      currentSnapshotId: f.currentSnapshotId,
      hunks: f.hunks,
      updatedAt: f.updatedAt,
    };
  }

  private emptyPublic(absolute: string): ScopedFileState {
    return {
      path: absolute,
      name: displayName(absolute),
      exists: false,
      content: "",
      mtimeMs: null,
      snapshots: [],
      currentSnapshotId: null,
      hunks: [],
      updatedAt: new Date().toISOString(),
    };
  }
}
