import { useEffect } from "react";

export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function formatServiceDateShort(serviceDate: string | null | undefined): string | null {
  if (!serviceDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(serviceDate);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return `${month}/${day}`;
}
