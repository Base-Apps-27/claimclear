import V3DrawerMiniInContext from "./V3DrawerMiniInContext";

/**
 * Imagining 3 — Inline expand.
 * Mini card lives in the page flow, expanding directly below the
 * chip strip. No overlay, no scrim, no shadow stack — the page
 * grows to include the panel and keeps everything navigable.
 */
export default function V3MiniImagineInline() {
  return <V3DrawerMiniInContext section="evidence" placement="inline" />;
}
