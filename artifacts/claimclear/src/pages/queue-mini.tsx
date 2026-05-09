import Queue from "@/pages/queue";

// Task #565 — Queue Mini right-pane remake. Mounts the Queue page with
// `variant="mini"` so the entire master list / filters / classification
// inbox stay identical and only the right pane swaps to the new
// InlineGroupWorkspaceMini. Same data, same mutations, different chrome.
export default function QueueMini() {
  return <Queue variant="mini" />;
}
