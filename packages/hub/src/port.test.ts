import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  PREFERRED_PORT_MAX,
  PREFERRED_PORT_MIN,
} from "@markdown-mcp/shared";
import {
  bindHttpServer,
  candidatePorts,
  isHighPort,
  isPortFree,
  randomHighPort,
} from "./port.js";

describe("port helpers", () => {
  it("isHighPort accepts only the preferred band", () => {
    assert.equal(isHighPort(PREFERRED_PORT_MIN), true);
    assert.equal(isHighPort(PREFERRED_PORT_MAX), true);
    assert.equal(isHighPort(80), false);
    assert.equal(isHighPort(PREFERRED_PORT_MIN - 1), false);
    assert.equal(isHighPort(PREFERRED_PORT_MAX + 1), false);
  });

  it("randomHighPort stays in band and can exclude values", () => {
    const exclude = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const p = randomHighPort(exclude);
      assert.ok(isHighPort(p), `port ${p} not high`);
      exclude.add(p);
    }
  });

  it("candidatePorts prefers sticky port first then unique high ports", () => {
    const preferred = 54321;
    const list = candidatePorts(preferred);
    assert.equal(list[0], preferred);
    assert.ok(list.length > 1);
    assert.equal(new Set(list).size, list.length);
    for (const p of list.slice(1)) {
      assert.ok(isHighPort(p));
    }
  });

  it("candidatePorts without preferred still returns high ports", () => {
    const list = candidatePorts(null);
    assert.ok(list.length >= 1);
    for (const p of list) assert.ok(isHighPort(p));
  });
});

describe("bindHttpServer sticky behavior", () => {
  it("binds the preferred port when free", async () => {
    // Find a free high port first
    let preferred = 0;
    for (let i = 0; i < 40; i++) {
      const p = randomHighPort();
      if (await isPortFree("127.0.0.1", p)) {
        preferred = p;
        break;
      }
    }
    assert.ok(preferred > 0, "could not find free high port for test");

    const server = createServer((_req, res) => {
      res.end("ok");
    });
    try {
      const bound = await bindHttpServer(server, "127.0.0.1", preferred);
      assert.equal(bound.port, preferred);
      assert.equal(bound.usedPreferred, true);
      assert.equal(bound.changedFromPreferred, false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("falls back when preferred port is in use", async () => {
    let preferred = 0;
    for (let i = 0; i < 40; i++) {
      const p = randomHighPort();
      if (await isPortFree("127.0.0.1", p)) {
        preferred = p;
        break;
      }
    }
    assert.ok(preferred > 0);

    const blocker = createServer((_req, res) => res.end("busy"));
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(preferred, "127.0.0.1", () => resolve());
    });

    const server = createServer((_req, res) => res.end("hub"));
    try {
      const bound = await bindHttpServer(server, "127.0.0.1", preferred);
      assert.notEqual(bound.port, preferred);
      assert.equal(bound.usedPreferred, false);
      assert.equal(bound.changedFromPreferred, true);
      assert.ok(bound.port > 0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
