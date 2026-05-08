// Side-effect-only module: installs jsdom globals BEFORE
// `@testing-library/dom` (and other DOM-touching modules) are imported.
//
// `@testing-library/dom`'s `screen` export is captured at module-load time
// — if `document.body` isn't on the global at that moment, every `screen`
// method throws "global document has to be available". ESM imports are
// hoisted in DFS-pre-order, so this file MUST be imported BEFORE any
// `@testing-library/*` or React DOM module in the test entry point.
//
// Underscore-prefix keeps it out of the `*.test.ts(x)` glob.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const w = dom.window as unknown as Window & typeof globalThis;

function setGlobal(key: string, value: unknown): void {
  // Some globals (notably `navigator` on Node 22+) are exposed as
  // getters on globalThis; plain assignment throws. defineProperty
  // sidesteps the getter and lets us swap in jsdom's implementation.
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  });
}

setGlobal("window", w);
setGlobal("document", w.document);
setGlobal("navigator", w.navigator);
setGlobal("HTMLElement", w.HTMLElement);
setGlobal("HTMLAnchorElement", w.HTMLAnchorElement);
setGlobal("HTMLButtonElement", w.HTMLButtonElement);
setGlobal("HTMLInputElement", w.HTMLInputElement);
setGlobal("HTMLTextAreaElement", w.HTMLTextAreaElement);
setGlobal("Element", w.Element);
setGlobal("Node", w.Node);
setGlobal("Event", w.Event);
setGlobal("CustomEvent", w.CustomEvent);
setGlobal("MouseEvent", w.MouseEvent);
setGlobal("KeyboardEvent", w.KeyboardEvent);
setGlobal("FocusEvent", w.FocusEvent);
setGlobal("InputEvent", w.InputEvent);
setGlobal("PointerEvent", w.PointerEvent);
setGlobal("NodeFilter", w.NodeFilter);
setGlobal("getComputedStyle", w.getComputedStyle.bind(w));
// Radix UI primitives (Dialog/Popover/etc.) read these globals at
// effect-mount time. Forward jsdom's implementations so portal-based
// components don't crash with "MutationObserver is not defined".
setGlobal(
  "MutationObserver",
  (w as unknown as { MutationObserver: unknown }).MutationObserver,
);
setGlobal("DocumentFragment", w.DocumentFragment);
setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number);
setGlobal("cancelAnimationFrame", (id: number) =>
  clearTimeout(id as unknown as NodeJS.Timeout));

// React 19's act() warning suppression flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
