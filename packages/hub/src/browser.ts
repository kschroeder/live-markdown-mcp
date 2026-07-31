import open from "open";

let opened = false;

export function resetBrowserFlag(): void {
  opened = false;
}

export function hasOpenedBrowser(): boolean {
  return opened;
}

export async function openBrowserOnce(url: string): Promise<boolean> {
  if (opened) return false;
  opened = true;
  try {
    await open(url, { wait: false });
    return true;
  } catch (err) {
    console.error("[markdown-mcp-hub] failed to open browser:", err);
    opened = false;
    return false;
  }
}
