import V3DrawerMiniInContext from "./V3DrawerMiniInContext";

/**
 * Imagining 2 — Edge drawer.
 * Mini card slides in from the right edge of the wizard pane.
 * Short (not full-height), vertically centered around the hero.
 * Reads as a "drawer" without taking over the whole side.
 */
export default function V3MiniImagineDrawer() {
  return <V3DrawerMiniInContext section="evidence" placement="drawer" />;
}
