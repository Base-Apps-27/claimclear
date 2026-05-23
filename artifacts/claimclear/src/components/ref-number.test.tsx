// Tests for <RefNumber /> and <CopyButton />: static render contract
// (chip/inline variants, `#`-stripping, empty fallback) plus
// interactive copy behavior (clipboard payload, 1.5s Check flash,
// stopPropagation). jsdom is installed via the shared
// `_setup-jsdom` side-effect module before any DOM-touching imports.

import "./decision-tree/terminals/_setup-jsdom.ts";

import { test } from "node:test";
import { strict as assert } from "node:assert";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { render, fireEvent, cleanup, act } = await import(
  "@testing-library/react"
);
const { RefNumber, CopyButton, CopyConfirmationButton } = await import(
  "./ref-number"
);

void React;

/* ------------------------------------------------------------------ */
/* Static render contract                                              */
/* ------------------------------------------------------------------ */

test("RefNumber renders chip variant by default with copy button", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, { value: "INV-12345" }),
  );
  assert.match(html, /INV-12345/);
  assert.match(html, /data-testid="copy-invoice-INV-12345"/);
  assert.match(html, /bg-blue-50/);
});

test("RefNumber inline variant omits chip background", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, {
      value: "INV-12345",
      variant: "inline",
    }),
  );
  assert.match(html, /INV-12345/);
  assert.match(html, /data-testid="copy-invoice-INV-12345"/);
  assert.doesNotMatch(html, /bg-blue-50/);
});

test("RefNumber strips a leading # from the displayed value and the copy payload", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, { value: "#INV-99", variant: "inline" }),
  );
  // testid carries the post-strip clipboard payload.
  assert.match(html, /data-testid="copy-invoice-INV-99"/);
  assert.doesNotMatch(html, /data-testid="copy-invoice-#/);
});

test("RefNumber strips multiple leading # characters", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, { value: "##INV-7", variant: "inline" }),
  );
  assert.match(html, /data-testid="copy-invoice-INV-7"/);
});

test("RefNumber renders dash for empty value", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, { value: "" }),
  );
  assert.match(html, /-/);
  assert.doesNotMatch(html, /copy-invoice/);
});

test("RefNumber renders dash for null value", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, { value: null }),
  );
  assert.match(html, /-/);
  assert.doesNotMatch(html, /copy-invoice/);
});

/* ------------------------------------------------------------------ */
/* Interactive: clipboard payload + Copy → Check flash                 */
/* ------------------------------------------------------------------ */

function installClipboard(): { writes: string[] } {
  const writes: string[] = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        writes.push(text);
      },
    },
  });
  return { writes };
}

test("CopyButton click writes the bare value to the clipboard (no leading #)", async (t) => {
  t.after(cleanup);
  const { writes } = installClipboard();
  const { getByTestId } = render(
    React.createElement(CopyButton, { value: "#INV-42" }),
  );
  await act(async () => {
    fireEvent.click(getByTestId("copy-invoice-INV-42"));
  });
  assert.deepEqual(writes, ["INV-42"]);
});

test("CopyButton click flashes Check for 1.5s then reverts to Copy", async (t) => {
  t.after(cleanup);
  installClipboard();
  const { container, getByTestId } = render(
    React.createElement(CopyButton, { value: "INV-200" }),
  );
  // Before click: Copy icon present, Check icon absent.
  assert.equal(container.querySelectorAll(".text-green-600").length, 0);

  await act(async () => {
    fireEvent.click(getByTestId("copy-invoice-INV-200"));
  });
  // Immediately after click: Check icon (text-green-600) is rendered.
  assert.equal(container.querySelectorAll(".text-green-600").length, 1);

  // After 1.5s the success state clears.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1600));
  });
  assert.equal(container.querySelectorAll(".text-green-600").length, 0);
});

test("CopyButton click does NOT trigger a parent click handler (stopPropagation)", async (t) => {
  t.after(cleanup);
  installClipboard();
  let parentClicks = 0;
  const { getByTestId } = render(
    React.createElement(
      "div",
      { onClick: () => parentClicks++ },
      React.createElement(CopyButton, { value: "INV-300" }),
    ),
  );
  await act(async () => {
    fireEvent.click(getByTestId("copy-invoice-INV-300"));
  });
  assert.equal(parentClicks, 0);
});

test("CopyButton renders nothing when value is empty or only `#`", () => {
  const html1 = renderToStaticMarkup(
    React.createElement(CopyButton, { value: "" }),
  );
  const html2 = renderToStaticMarkup(
    React.createElement(CopyButton, { value: "#" }),
  );
  assert.equal(html1, "");
  assert.equal(html2, "");
});

/* ------------------------------------------------------------------ */
/* CopyConfirmationButton (Task #844)                                  */
/* ------------------------------------------------------------------ */

test("CopyConfirmationButton renders with confirmation-specific testid + label", () => {
  const html = renderToStaticMarkup(
    React.createElement(CopyConfirmationButton, { value: "CONF-1" }),
  );
  assert.match(html, /data-testid="copy-conf-CONF-1"/);
  assert.match(html, /title="Copy confirmation number"/);
  assert.match(html, /aria-label="Copy confirmation number"/);
});

test("CopyConfirmationButton click writes the bare value to the clipboard", async (t) => {
  t.after(cleanup);
  const { writes } = installClipboard();
  const { getByTestId } = render(
    React.createElement(CopyConfirmationButton, { value: "#CONF-42" }),
  );
  await act(async () => {
    fireEvent.click(getByTestId("copy-conf-CONF-42"));
  });
  assert.deepEqual(writes, ["CONF-42"]);
});

test("CopyConfirmationButton click stops propagation to row handlers", async (t) => {
  t.after(cleanup);
  installClipboard();
  let parentClicks = 0;
  const { getByTestId } = render(
    React.createElement(
      "div",
      { onClick: () => parentClicks++ },
      React.createElement(CopyConfirmationButton, { value: "CONF-9" }),
    ),
  );
  await act(async () => {
    fireEvent.click(getByTestId("copy-conf-CONF-9"));
  });
  assert.equal(parentClicks, 0);
});

test("CopyConfirmationButton flashes Check for 1.5s then reverts", async (t) => {
  t.after(cleanup);
  installClipboard();
  const { container, getByTestId } = render(
    React.createElement(CopyConfirmationButton, { value: "CONF-200" }),
  );
  assert.equal(container.querySelectorAll(".text-green-600").length, 0);
  await act(async () => {
    fireEvent.click(getByTestId("copy-conf-CONF-200"));
  });
  assert.equal(container.querySelectorAll(".text-green-600").length, 1);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1600));
  });
  assert.equal(container.querySelectorAll(".text-green-600").length, 0);
});

test("CopyConfirmationButton renders nothing when value is empty or only `#`", () => {
  const html1 = renderToStaticMarkup(
    React.createElement(CopyConfirmationButton, { value: "" }),
  );
  const html2 = renderToStaticMarkup(
    React.createElement(CopyConfirmationButton, { value: "#" }),
  );
  assert.equal(html1, "");
  assert.equal(html2, "");
});

test("RefNumber with kind=confirmation renders the confirmation copy button", () => {
  const html = renderToStaticMarkup(
    React.createElement(RefNumber, {
      value: "CONF-77",
      variant: "inline",
      kind: "confirmation",
    }),
  );
  assert.match(html, /data-testid="copy-conf-CONF-77"/);
  assert.doesNotMatch(html, /copy-invoice-/);
});
