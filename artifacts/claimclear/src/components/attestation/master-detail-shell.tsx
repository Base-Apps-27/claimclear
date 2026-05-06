import type { ReactNode } from "react";

/**
 * Shared 320px-sidebar + flex-detail grid used by both the Open and
 * Completed tabs of the Attestation page.
 */
export function MasterDetailShell({
  sidebar,
  detail,
}: {
  sidebar: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      {sidebar}
      {detail}
    </div>
  );
}
