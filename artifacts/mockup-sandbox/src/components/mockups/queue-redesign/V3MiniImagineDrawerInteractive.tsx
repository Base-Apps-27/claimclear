import V3DrawerMiniInContext from "./V3DrawerMiniInContext";

/**
 * Edge drawer — fully interactive.
 * Click any chip (Evidence / Notes / Comms / Activity) to swap the
 * section selection card. The floating leg-context header stays put,
 * the lower section card swaps content. Both cards animate in/out
 * together as one drawer manifestation.
 */
export default function V3MiniImagineDrawerInteractive() {
  return <V3DrawerMiniInContext section="evidence" placement="drawer" interactive />;
}
