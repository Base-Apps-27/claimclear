// Task #678 — per-leg page rewires "Open group ↗" arrows
// (`GoToGroupLink`) to open the right-edge ChipDrawerOverlay
// directly, using the page's already-fetched parentGroup + claim.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const claimDetailSource = readFileSync(
  join(here, "claim-detail-v2.tsx"),
  "utf8",
);
const overlaySource = readFileSync(
  join(here, "chip-drawer-overlay.tsx"),
  "utf8",
);

test("claim-detail-v2 imports ChipDrawerOverlay (the component, not a wrapper)", () => {
  assert.match(
    claimDetailSource,
    /import\s+\{[\s\S]*?\bChipDrawerOverlay\b[\s\S]*?\}\s+from\s+"@\/components\/chip-drawer-overlay"/,
  );
  assert.ok(
    !/\bChipDrawerOverlayMount\b/.test(claimDetailSource),
    "wrapper component must no longer be referenced",
  );
  assert.ok(
    !/\bChipDrawerOverlayMount\b/.test(overlaySource),
    "wrapper component must be removed from chip-drawer-overlay.tsx",
  );
});

test("claim-detail-v2 mounts <ChipDrawerOverlay /> directly with onSelectLeg=null and onOpenClassify wired", () => {
  const m = claimDetailSource.match(/<ChipDrawerOverlay\b[\s\S]*?\/>/);
  assert.ok(m, "expected a self-closing <ChipDrawerOverlay /> mount");
  const tag = m![0];
  assert.match(tag, /openChip=\{chipOpen\}/);
  assert.match(tag, /leg=\{claim\}/);
  assert.match(tag, /onSelectLeg=\{null\}/);
  assert.match(
    tag,
    /onOpenClassify=\{[^}]*setClassifyOpen\(true\)[^}]*\}/,
    "onOpenClassify must wire to the page's classify dialog",
  );
});

test("GoToGroupLink renders a <button> with leg-open-group-overlay test id, not a wouter <Link>", () => {
  const m = claimDetailSource.match(
    /function GoToGroupLink\(\{[\s\S]*?\}\s*:\s*\{[\s\S]*?\}\)\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(m, "GoToGroupLink function must be defined");
  const body = m![1];
  assert.match(body, /<button\b/);
  assert.match(body, /type="button"/);
  assert.match(body, /data-testid="leg-open-group-overlay"/);
  assert.match(body, /onClick=\{onOpen\}/);
  assert.ok(!/<Link\b/.test(body), "GoToGroupLink must not use wouter <Link>");
  assert.ok(!/\bhref=/.test(body), "GoToGroupLink must not carry an href");
});

test("every <GoToGroupLink> callsite passes onOpen, not groupId", () => {
  const callsites = claimDetailSource.match(/<GoToGroupLink[^>]*>/g) ?? [];
  assert.ok(callsites.length >= 1, "expected at least one callsite");
  for (const tag of callsites) {
    assert.ok(/\bonOpen=/.test(tag), `callsite must pass onOpen: ${tag}`);
    assert.ok(
      !/\bgroupId=/.test(tag),
      `callsite must not pass groupId anymore: ${tag}`,
    );
  }
});
