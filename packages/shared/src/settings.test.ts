import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeSettings, normalizePreferredPort } from "./index.js";

describe("normalizePreferredPort", () => {
  it("treats empty / zero / invalid as null", () => {
    assert.equal(normalizePreferredPort(null), null);
    assert.equal(normalizePreferredPort(undefined), null);
    assert.equal(normalizePreferredPort(""), null);
    assert.equal(normalizePreferredPort(0), null);
    assert.equal(normalizePreferredPort(-1), null);
    assert.equal(normalizePreferredPort(999999), null);
    assert.equal(normalizePreferredPort("nope"), null);
  });

  it("accepts valid ports", () => {
    assert.equal(normalizePreferredPort(49152), 49152);
    assert.equal(normalizePreferredPort("8080"), 8080);
    assert.equal(normalizePreferredPort(80.9), 80);
  });
});

describe("mergeSettings preferredPort", () => {
  it("defaults preferredPort to null", () => {
    const s = mergeSettings(null);
    assert.equal(s.preferredPort, null);
  });

  it("merges preferredPort from partial", () => {
    const s = mergeSettings({ preferredPort: 55555 });
    assert.equal(s.preferredPort, 55555);
  });

  it("normalizes bad preferredPort to null", () => {
    const s = mergeSettings({ preferredPort: 0 as unknown as number });
    assert.equal(s.preferredPort, null);
  });
});
