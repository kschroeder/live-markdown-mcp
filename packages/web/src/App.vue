<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { AppSettings, HubPublicState, ScopedFileState } from "@markdown-mcp/shared";
import { DEFAULT_SETTINGS } from "@markdown-mcp/shared";
import { connectWs, fetchSnapshot, fetchState, saveSettings, unwatch } from "./api";
import { applyTheme, cycleTheme } from "./theme";
import { renderMarkdownWithDiffs, runMermaid } from "./markdown";

const state = ref<HubPublicState | null>(null);
const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
const activePath = ref<string | null>(null);
const unread = ref<Set<string>>(new Set());
const showChanges = ref(true);
const side = ref<"history" | "settings" | null>(null);
const viewingSnapshotId = ref<string | null>(null);
const snapshotContent = ref<string | null>(null);
const viewerEl = ref<HTMLElement | null>(null);
const proseEl = ref<HTMLElement | null>(null);
const scrollPositions = new Map<string, number>();
const wizardOpen = ref(false);
const draftSettings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
const errorMsg = ref("");

let disconnectWs: (() => void) | null = null;

const files = computed(() => state.value?.files ?? []);
const activeFile = computed(() => files.value.find((f) => f.path === activePath.value) ?? null);

const displayContent = computed(() => {
  if (snapshotContent.value !== null) return snapshotContent.value;
  return activeFile.value?.content ?? "";
});

const html = computed(() =>
  renderMarkdownWithDiffs(
    displayContent.value,
    viewingSnapshotId.value ? [] : activeFile.value?.hunks ?? [],
    showChanges.value && !viewingSnapshotId.value
  )
);

const settingsHydrated = ref(false);

function onState(s: HubPublicState) {
  state.value = s;
  settings.value = s.settings;
  if (!settingsHydrated.value) {
    showChanges.value = s.settings.showChangesByDefault;
    draftSettings.value = { ...s.settings };
    settingsHydrated.value = true;
  }
  applyTheme(s.settings.theme);
  wizardOpen.value = !s.settings.firstRunCompleted;

  if (!activePath.value && s.files.length) {
    activePath.value = s.files[0]!.path;
  }
}

function onFileUpdate(f: ScopedFileState) {
  if (!state.value) return;
  const idx = state.value.files.findIndex((x) => x.path === f.path);
  const filesCopy = [...state.value.files];
  if (idx >= 0) filesCopy[idx] = f;
  else filesCopy.push(f);
  state.value = { ...state.value, files: filesCopy };

  if (f.path !== activePath.value) {
    unread.value = new Set(unread.value).add(f.path);
  } else if (viewingSnapshotId.value === null && settings.value.preserveScroll) {
    // stay; scroll restored in watch
  }
  if (!activePath.value) activePath.value = f.path;
}

function onFileRemoved(path: string) {
  if (!state.value) return;
  state.value = {
    ...state.value,
    files: state.value.files.filter((f) => f.path !== path),
  };
  unread.value.delete(path);
  if (activePath.value === path) {
    activePath.value = state.value.files[0]?.path ?? null;
  }
}

function activate(path: string) {
  if (activePath.value && viewerEl.value) {
    scrollPositions.set(activePath.value, viewerEl.value.scrollTop);
  }
  activePath.value = path;
  viewingSnapshotId.value = null;
  snapshotContent.value = null;
  const next = new Set(unread.value);
  next.delete(path);
  unread.value = next;
  nextTick(() => {
    if (viewerEl.value && settings.value.preserveScroll) {
      viewerEl.value.scrollTop = scrollPositions.get(path) ?? 0;
    }
  });
}

async function closeTab(path: string) {
  await unwatch(path);
  onFileRemoved(path);
}

async function selectSnapshot(id: string | null) {
  viewingSnapshotId.value = id;
  if (!id || !activeFile.value) {
    snapshotContent.value = null;
    return;
  }
  try {
    const { content } = await fetchSnapshot(activeFile.value.path, id);
    snapshotContent.value = content;
  } catch (e) {
    errorMsg.value = String(e);
  }
}

function toggleSide(mode: "history" | "settings") {
  side.value = side.value === mode ? null : mode;
  if (side.value === "settings") {
    draftSettings.value = { ...settings.value };
  }
}

async function persistSettings(partial: Partial<AppSettings>, confirmNonLocal = false) {
  try {
    errorMsg.value = "";
    const next = await saveSettings(
      { ...settings.value, ...partial },
      { confirmNonLocal }
    );
    settings.value = next;
    draftSettings.value = { ...next };
    applyTheme(next.theme);
    if (partial.showChangesByDefault !== undefined) {
      showChanges.value = next.showChangesByDefault;
    }
  } catch (e) {
    errorMsg.value = String(e);
  }
}

/** Toolbar Changes toggle — keep hub settings.json in sync across refresh/restart. */
async function toggleShowChanges() {
  const next = !showChanges.value;
  showChanges.value = next;
  settings.value = { ...settings.value, showChangesByDefault: next };
  draftSettings.value = { ...draftSettings.value, showChangesByDefault: next };
  try {
    errorMsg.value = "";
    const saved = await saveSettings({
      ...settings.value,
      showChangesByDefault: next,
    });
    settings.value = saved;
  } catch (e) {
    // Revert UI if persist fails
    showChanges.value = !next;
    settings.value = { ...settings.value, showChangesByDefault: !next };
    errorMsg.value = String(e);
  }
}

async function finishWizard(useDefaults: boolean) {
  const payload = useDefaults
    ? { ...settings.value, firstRunCompleted: true }
    : { ...draftSettings.value, firstRunCompleted: true };
  const nonLocal =
    payload.bindHost !== "127.0.0.1" &&
    payload.bindHost !== "localhost" &&
    payload.bindHost !== "";
  if (nonLocal && !useDefaults) {
    const ok = window.confirm(
      `Bind host "${payload.bindHost}" is not loopback. This may expose previews on your network. Continue?`
    );
    if (!ok) return;
  }
  await persistSettings(payload, nonLocal);
  wizardOpen.value = false;
  side.value = null;
}

async function saveSettingsPanel() {
  const nonLocal =
    draftSettings.value.bindHost !== "127.0.0.1" &&
    draftSettings.value.bindHost !== "localhost";
  if (nonLocal) {
    const ok = window.confirm(
      `Bind host "${draftSettings.value.bindHost}" is not loopback. Continue?`
    );
    if (!ok) return;
  }
  await persistSettings(draftSettings.value, nonLocal);
  side.value = null;
}

function onThemeCycle() {
  const next = cycleTheme(settings.value.theme);
  draftSettings.value = { ...settings.value, theme: next };
  void persistSettings({ theme: next });
}

watch(
  html,
  async () => {
    await nextTick();
    if (proseEl.value) await runMermaid(proseEl.value);
  },
  { flush: "post" }
);

watch(activePath, (path, prev) => {
  if (prev && viewerEl.value) {
    scrollPositions.set(prev, viewerEl.value.scrollTop);
  }
  viewingSnapshotId.value = null;
  snapshotContent.value = null;
});

onMounted(async () => {
  try {
    const s = await fetchState();
    onState(s);
    if (s.settings.showChangesByDefault !== undefined) {
      showChanges.value = s.settings.showChangesByDefault;
    }
  } catch {
    /* hub may still be starting */
  }
  disconnectWs = connectWs({
    onState,
    onFileUpdate,
    onFileRemoved,
    onSettings: (s) => {
      settings.value = s;
      draftSettings.value = { ...s };
      applyTheme(s.theme);
      // Stay aligned when settings change elsewhere (other tab / settings panel)
      showChanges.value = s.showChangesByDefault;
    },
  });

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (settings.value.theme === "system") applyTheme("system");
  };
  mq.addEventListener("change", onScheme);
  onUnmounted(() => mq.removeEventListener("change", onScheme));
});

onUnmounted(() => {
  disconnectWs?.();
});

const rootsText = computed({
  get: () => (draftSettings.value.allowedRoots ?? []).join("\n"),
  set: (v: string) => {
    draftSettings.value = {
      ...draftSettings.value,
      allowedRoots: v
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    };
  },
});
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <div class="logo" aria-hidden="true" />
        <div class="brand-text">
          <strong>MarkdownMCP</strong>
          <span>Live preview</span>
        </div>
      </div>

      <div class="top-actions">
        <button
          type="button"
          class="pill-toggle"
          :aria-pressed="showChanges"
          title="Highlight additions, edits, and removals (saved to settings)"
          @click="toggleShowChanges"
        >
          <span class="switch" aria-hidden="true" />
          Changes
        </button>
        <button
          type="button"
          class="pill-toggle"
          :aria-pressed="side === 'history'"
          title="Browse recent versions"
          @click="toggleSide('history')"
        >
          History
        </button>
        <button type="button" class="icon-btn" title="Cycle theme" @click="onThemeCycle">
          ◐
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Settings"
          :aria-pressed="side === 'settings'"
          @click="toggleSide('settings')"
        >
          ⚙
        </button>
      </div>
    </header>

    <div class="stage" :class="{ 'with-side': side }">
      <div class="stage-main">
        <div class="tabstrip" role="tablist" aria-label="Open documents">
          <button
            v-for="f in files"
            :key="f.path"
            type="button"
            class="tab"
            role="tab"
            :class="{ active: f.path === activePath }"
            :aria-selected="f.path === activePath"
            :title="f.path"
            @click="activate(f.path)"
          >
            <span v-if="unread.has(f.path) && f.path !== activePath" class="dot" title="Updated" />
            <span class="tab-name">{{ f.name }}</span>
            <span
              class="x"
              title="Close"
              aria-label="Close"
              @click.stop="closeTab(f.path)"
            >
              ×
            </span>
          </button>
          <div class="tab-spacer" />
          <span v-if="files.length" class="live-chip">Live</span>
        </div>

        <div ref="viewerEl" class="viewer">
          <div v-if="!activeFile" class="empty">
            <div>
              <div class="empty-illu" aria-hidden="true">✎</div>
              <h2>Nothing on the canvas yet</h2>
              <p>
                When an agent scopes a markdown file and writes it, the browser opens and the live
                preview appears here.
              </p>
            </div>
          </div>

          <article v-else class="doc-card">
            <div class="path-row">
              <code>{{ activeFile.path }}</code>
              <span class="meta">
                {{
                  viewingSnapshotId
                    ? "Viewing snapshot"
                    : `Updated ${new Date(activeFile.updatedAt).toLocaleTimeString()}`
                }}
              </span>
            </div>
            <div
              ref="proseEl"
              class="prose"
              :class="{ 'show-changes': showChanges && !viewingSnapshotId }"
              v-html="html"
            />
          </article>
        </div>
      </div>

      <aside v-if="side" class="side">
        <div class="side-inner">
          <div class="side-tabs" role="tablist">
            <button
              type="button"
              :aria-selected="side === 'history'"
              @click="side = 'history'"
            >
              History
            </button>
            <button
              type="button"
              :aria-selected="side === 'settings'"
              @click="side = 'settings'; draftSettings = { ...settings }"
            >
              Settings
            </button>
          </div>

          <template v-if="side === 'history'">
            <h2>Version trail</h2>
            <p class="sub">
              Snapshots when the file changes on disk. Toggle <strong>Changes</strong> to see diff
              marks on the latest version.
            </p>
            <div class="legend" aria-hidden="true">
              <span><i class="c-add" /> added</span>
              <span><i class="c-mod" /> edited</span>
              <span><i class="c-del" /> removed</span>
            </div>
            <ul v-if="activeFile" class="timeline">
              <li
                v-for="snap in [...activeFile.snapshots].reverse()"
                :key="snap.id"
                :class="{
                  current:
                    (viewingSnapshotId ?? activeFile.currentSnapshotId) === snap.id,
                }"
              >
                <span class="mark" aria-hidden="true" />
                <button type="button" class="hist-card" @click="selectSnapshot(snap.id)">
                  <strong>{{ snap.label }}</strong>
                  <span>{{ new Date(snap.createdAt).toLocaleString() }}</span>
                  <div class="chips">
                    <span v-if="snap.stats.add" class="chip add">+{{ snap.stats.add }}</span>
                    <span v-if="snap.stats.mod" class="chip mod">~{{ snap.stats.mod }}</span>
                    <span v-if="snap.stats.del" class="chip del">−{{ snap.stats.del }}</span>
                  </div>
                </button>
              </li>
            </ul>
            <p v-else class="sub">Select a tab to see history.</p>
            <button
              v-if="viewingSnapshotId"
              type="button"
              class="btn"
              style="margin-top: 12px"
              @click="selectSnapshot(null)"
            >
              Back to live
            </button>
          </template>

          <template v-else>
            <h2>Settings</h2>
            <p class="sub">Saved on the hub. Same fields as first-run.</p>
            <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

            <div class="field">
              <label>Appearance</label>
              <div class="seg" role="radiogroup">
                <button
                  v-for="t in (['light', 'dark', 'system'] as const)"
                  :key="t"
                  type="button"
                  :aria-checked="draftSettings.theme === t"
                  @click="draftSettings = { ...draftSettings, theme: t }"
                >
                  {{ t[0]!.toUpperCase() + t.slice(1) }}
                </button>
              </div>
            </div>

            <div class="field">
              <label for="bindHost">Bind host</label>
              <input id="bindHost" v-model="draftSettings.bindHost" type="text" spellcheck="false" />
              <p class="hint">Default loopback. Restart hub after changing bind host.</p>
            </div>

            <div class="field">
              <label for="roots">Allowed path roots (one per line)</label>
              <textarea id="roots" v-model="rootsText" spellcheck="false" />
              <p class="hint">Empty means any path may be scoped.</p>
            </div>

            <label class="check">
              <input v-model="draftSettings.openBrowserOnFirstFileEvent" type="checkbox" />
              <span>
                <strong>Open browser on first file event</strong>
                Not when the hub starts.
              </span>
            </label>
            <label class="check">
              <input v-model="draftSettings.preserveScroll" type="checkbox" />
              <span>
                <strong>Preserve scroll on reload</strong>
              </span>
            </label>
            <label class="check">
              <input v-model="draftSettings.showChangesByDefault" type="checkbox" />
              <span>
                <strong>Show changes by default</strong>
              </span>
            </label>

            <div class="btn-row">
              <button type="button" class="btn primary" @click="saveSettingsPanel">Save</button>
              <button type="button" class="btn" @click="side = null">Close</button>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </div>

  <div v-if="wizardOpen" class="overlay" role="dialog" aria-modal="true">
    <div class="wizard">
      <div class="wizard-badge">First run</div>
      <h1>Make it feel like home</h1>
      <p class="lead">
        A minute of setup. After that, agents only ping once when a markdown file comes into scope.
      </p>

      <div class="field">
        <label>Appearance</label>
        <div class="seg">
          <button
            v-for="t in (['light', 'dark', 'system'] as const)"
            :key="t"
            type="button"
            :aria-checked="draftSettings.theme === t"
            @click="draftSettings = { ...draftSettings, theme: t }"
          >
            {{ t[0]!.toUpperCase() + t.slice(1) }}
          </button>
        </div>
      </div>
      <div class="field">
        <label for="wizHost">Bind host</label>
        <input id="wizHost" v-model="draftSettings.bindHost" type="text" spellcheck="false" />
      </div>
      <div class="field">
        <label for="wizRoots">Allowed path roots</label>
        <textarea id="wizRoots" v-model="rootsText" spellcheck="false" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn primary" @click="finishWizard(false)">
          Save &amp; continue
        </button>
        <button type="button" class="btn" @click="finishWizard(true)">Use defaults</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 18px 20px 20px;
  gap: 14px;
}

.top {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  background: linear-gradient(145deg, var(--accent) 0%, #d4a574 100%);
  box-shadow: var(--shadow-sm);
  position: relative;
}
.logo::after {
  content: "";
  position: absolute;
  inset: 9px;
  border-radius: 2px;
  border: 2px solid rgba(255, 252, 247, 0.9);
  border-top-width: 0;
  border-right-width: 0;
  transform: rotate(-45deg) translate(1px, -1px);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand-text strong {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.brand-text span {
  font-size: 11.5px;
  color: var(--ink-faint);
  font-weight: 500;
}

.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--ink-soft);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pill-toggle[aria-pressed="true"] {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--accent-deep);
  box-shadow: none;
}
:global([data-theme="dark"]) .pill-toggle[aria-pressed="true"] {
  color: var(--accent);
}

.switch {
  width: 30px;
  height: 18px;
  border-radius: 4px;
  background: var(--bg-wash);
  border: 1px solid var(--line-strong);
  position: relative;
  flex-shrink: 0;
}
.pill-toggle[aria-pressed="true"] .switch {
  background: var(--accent);
  border-color: transparent;
}
.switch::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s;
}
.pill-toggle[aria-pressed="true"] .switch::after {
  transform: translateX(12px);
  background: #fff;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--ink-soft);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 16px;
}
.icon-btn[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-color: transparent;
  box-shadow: none;
}

.stage {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 0;
  height: 100%;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  border: 1px solid var(--line);
  overflow: hidden;
}
.stage.with-side {
  grid-template-columns: 1fr min(320px, 34vw);
}
.stage-main {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  min-height: 0;
}

.tabstrip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 0;
  overflow-x: auto;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 200px;
  padding: 9px 10px 9px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-soft);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.tab.active {
  background: var(--surface-2);
  color: var(--ink);
  border-color: var(--line);
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  flex-shrink: 0;
}
.x {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--ink-faint);
  display: grid;
  place-items: center;
  opacity: 0;
  font-size: 15px;
}
.tab:hover .x,
.tab.active .x {
  opacity: 1;
}
.x:hover {
  background: var(--bg-wash);
  color: var(--ink);
}
.tab-spacer {
  flex: 1;
}
.live-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--mint-soft);
  color: var(--mint);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.live-chip::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: currentColor;
}

.viewer {
  overflow: auto;
  min-height: 0;
  padding: 8px 8px 28px;
}
.empty {
  display: grid;
  place-items: center;
  min-height: 420px;
  text-align: center;
  padding: 40px 24px;
  color: var(--ink-faint);
}
.empty-illu {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  border-radius: 8px;
  background: var(--accent-soft);
  display: grid;
  place-items: center;
  font-size: 28px;
}
.empty h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--ink);
}
.empty p {
  margin: 0;
  max-width: 340px;
  line-height: 1.55;
  font-size: 14.5px;
  color: var(--ink-soft);
}

.doc-card {
  max-width: 760px;
  margin: 8px auto 0;
  padding: 8px 28px 48px;
}
.path-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.path-row code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-soft);
  background: var(--surface-2);
  padding: 5px 10px;
  border-radius: var(--radius-sm);
}
.meta {
  font-size: 12.5px;
  color: var(--ink-faint);
  font-weight: 500;
}

.prose :deep(h1) {
  margin: 0 0 10px;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}
.prose :deep(h2) {
  margin: 1.7em 0 0.55em;
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.prose :deep(p) {
  margin: 0.85em 0;
  line-height: 1.7;
}
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0.75em 0;
  padding-left: 1.25em;
  line-height: 1.65;
}
.prose :deep(a) {
  color: var(--accent-deep);
  font-weight: 600;
  text-decoration: none;
}
.prose :deep(a:hover) {
  text-decoration: underline;
}
.prose :deep(code) {
  font-family: var(--mono);
  font-size: 0.88em;
  background: var(--prose-code-bg);
  padding: 0.15em 0.42em;
  border-radius: 3px;
}
.prose :deep(pre) {
  margin: 1.1em 0;
  padding: 16px 18px;
  overflow: auto;
  border-radius: 6px;
  background: var(--prose-pre-bg);
  color: var(--prose-pre-fg);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.55;
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
.prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1.1em 0;
  font-size: 0.95rem;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}
.prose :deep(th),
.prose :deep(td) {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.prose :deep(th) {
  background: var(--surface-2);
  font-weight: 700;
  font-size: 12.5px;
}
.prose :deep(blockquote) {
  margin: 1.1em 0;
  padding: 4px 0 4px 16px;
  border-left: 3px solid var(--accent);
  color: var(--ink-soft);
}
.prose :deep(.mermaid-wrap) {
  margin: 1.2em 0;
  text-align: center;
  overflow-x: auto;
}
.prose :deep(.mermaid-error) {
  text-align: left;
  margin: 0;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--prose-code-bg);
  font-family: var(--mono);
  font-size: 12.5px;
  overflow: auto;
}
.prose :deep(.mermaid-error-msg) {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ink-faint);
}

.prose :deep(.diff-line) {
  border-radius: 3px;
  padding: 2px 8px 2px 12px;
  margin: 2px 0;
  box-decoration-break: clone;
}
.prose.show-changes :deep(.diff-add) {
  background: var(--diff-add-bg);
  box-shadow: inset 3px 0 0 var(--diff-add-bar);
}
.prose.show-changes :deep(.diff-mod) {
  background: var(--diff-mod-bg);
  box-shadow: inset 3px 0 0 var(--diff-mod-bar);
}
.prose.show-changes :deep(.diff-del) {
  background: var(--diff-del-bg);
  box-shadow: inset 3px 0 0 var(--diff-del-bar);
  text-decoration: line-through;
  color: var(--ink-soft);
}
.prose:not(.show-changes) :deep(.diff-del) {
  display: none;
}
.prose:not(.show-changes) :deep(.diff-add),
.prose:not(.show-changes) :deep(.diff-mod) {
  background: transparent;
  box-shadow: none;
}

.side {
  border-left: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-2) 65%, var(--surface));
  overflow: auto;
  min-height: 0;
}
.side-inner {
  padding: 18px 16px 28px;
}
.side h2 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
}
.sub {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--ink-faint);
  line-height: 1.45;
}
.error {
  color: var(--rose);
  font-size: 13px;
}

.side-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 3px;
  margin-bottom: 16px;
  border-radius: var(--radius);
  background: var(--bg-wash);
  border: 1px solid var(--line);
}
.side-tabs button {
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.side-tabs button[aria-selected="true"] {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-soft);
}
.legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
  margin-right: 4px;
}
.legend .c-add {
  background: var(--mint);
}
.legend .c-mod {
  background: var(--amber);
}
.legend .c-del {
  background: var(--rose);
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
.timeline::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--line-strong);
}
.timeline li {
  position: relative;
  padding: 0 0 14px 32px;
}
.timeline .mark {
  position: absolute;
  left: 4px;
  top: 6px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--surface);
  border: 2px solid var(--ink-faint);
  z-index: 1;
}
.timeline li.current .mark {
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.hist-card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  padding: 10px 12px;
  cursor: pointer;
}
.hist-card strong {
  display: block;
  font-size: 13px;
  margin-bottom: 3px;
}
.hist-card span {
  font-size: 12px;
  color: var(--ink-faint);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.chip {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
}
.chip.add {
  background: var(--mint-soft);
  color: var(--mint);
}
.chip.mod {
  background: var(--amber-soft);
  color: var(--amber);
}
.chip.del {
  background: var(--rose-soft);
  color: var(--rose);
}

.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
}
.hint {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-faint);
}
.seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  padding: 3px;
  border-radius: var(--radius);
  background: var(--bg-wash);
  border: 1px solid var(--line);
}
.seg button {
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 6px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.seg button[aria-checked="true"] {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
input[type="text"],
textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  font-size: 13px;
}
textarea {
  min-height: 84px;
  resize: vertical;
  font-family: var(--mono);
  font-size: 12px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border-radius: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  margin-bottom: 10px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
}
.check strong {
  display: block;
  margin-bottom: 2px;
}
.check span {
  color: var(--ink-soft);
}
.btn-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.btn {
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 9px 16px;
  background: var(--surface);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 16px var(--accent-glow);
}

.overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(42, 39, 48, 0.35);
  backdrop-filter: blur(8px);
  z-index: 50;
  padding: 24px;
}
.wizard {
  width: min(440px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 28px 26px 24px;
}
.wizard-badge {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 12px;
}
.wizard h1 {
  margin: 0 0 8px;
  font-size: 1.45rem;
  letter-spacing: -0.03em;
}
.lead {
  margin: 0 0 18px;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.5;
}
</style>
