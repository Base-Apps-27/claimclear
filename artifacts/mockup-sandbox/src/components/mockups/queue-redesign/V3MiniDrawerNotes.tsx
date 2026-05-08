import V3DrawerMiniInContext from "./V3DrawerMiniInContext";

/**
 * Edge drawer — Notes selection.
 * Same stack as the Evidence drawer: floating leg-context header on
 * top, gap, then the Notes selection card.
 */
export default function V3MiniDrawerNotes() {
  return <V3DrawerMiniInContext section="notes" placement="drawer" />;
}
