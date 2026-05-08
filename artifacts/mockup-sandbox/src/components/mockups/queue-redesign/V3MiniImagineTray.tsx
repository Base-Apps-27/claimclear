import V3DrawerMiniInContext from "./V3DrawerMiniInContext";

/**
 * Imagining 4 — Bottom tray.
 * Mini card docks at the bottom of the wizard pane, just above
 * the submission footer. Like a Slack/Notion peek tray — present
 * but not in the way of the SOP question or the chip row.
 */
export default function V3MiniImagineTray() {
  return <V3DrawerMiniInContext section="evidence" placement="tray" />;
}
