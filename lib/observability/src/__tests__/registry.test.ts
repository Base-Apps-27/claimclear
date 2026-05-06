import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ACTION_NAMES,
  SOURCE_TO_ACTION_TABLE,
  TRANSITION_SOURCES,
  actionForSource,
  fromLegacyActor,
  isAuditActionName,
  isTransitionSource,
  resolveAuditAction,
  toLegacyActor,
} from "../index";

describe("observability registry", () => {
  it("every source has an entry in the registry", () => {
    for (const src of TRANSITION_SOURCES) {
      assert.ok(SOURCE_TO_ACTION_TABLE[src], `missing entry for source ${src}`);
    }
  });

  it("every registry value is a known audit action name", () => {
    for (const src of TRANSITION_SOURCES) {
      const action = actionForSource(src);
      assert.ok(isAuditActionName(action), `${src} maps to unknown action ${action}`);
    }
  });

  it("resolveAuditAction returns the same value as actionForSource", () => {
    for (const src of TRANSITION_SOURCES) {
      const a = actionForSource(src);
      const b = resolveAuditAction({ source: src, fromState: null, toState: "x" });
      assert.equal(a, b);
    }
  });

  it("source enumeration has no duplicates", () => {
    const set = new Set(TRANSITION_SOURCES);
    assert.equal(set.size, TRANSITION_SOURCES.length);
  });

  it("audit action enumeration has no duplicates", () => {
    const set = new Set(AUDIT_ACTION_NAMES);
    assert.equal(set.size, AUDIT_ACTION_NAMES.length);
  });

  it("isTransitionSource guards correctly", () => {
    assert.equal(isTransitionSource("manual_exclude"), true);
    assert.equal(isTransitionSource("not_a_source"), false);
  });

  it("isAuditActionName guards correctly", () => {
    assert.equal(isAuditActionName("leg_excluded"), true);
    assert.equal(isAuditActionName("not_an_action"), false);
  });
});

describe("observability actor shape", () => {
  it("user actor round-trips through legacy shape", () => {
    const actor = { kind: "user" as const, email: "alice@example.com", name: "Alice" };
    const legacy = toLegacyActor(actor);
    assert.equal(legacy.userEmail, "alice@example.com");
    assert.equal(legacy.userName, "Alice");
    const back = fromLegacyActor(legacy);
    assert.deepEqual(back, actor);
  });

  it("system actor round-trips through legacy shape", () => {
    const actor = { kind: "system" as const, scope: "expired_sweep_cron" };
    const legacy = toLegacyActor(actor);
    assert.equal(legacy.userEmail, "system@expired_sweep_cron");
    assert.equal(legacy.userName, null);
    const back = fromLegacyActor(legacy);
    assert.deepEqual(back, actor);
  });

  it("legacy literal 'system' actor maps to system kind with unknown scope", () => {
    const back = fromLegacyActor({ userEmail: "system", userName: "Backfill" });
    assert.deepEqual(back, { kind: "system", scope: "unknown" });
  });

  it("legacy null email maps to system kind with unknown scope", () => {
    const back = fromLegacyActor({ userEmail: null, userName: null });
    assert.deepEqual(back, { kind: "system", scope: "unknown" });
  });
});
