import { useSearchParams } from "wouter";

export function useUrlParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  function get(key: string): string {
    return searchParams.get(key) ?? "";
  }

  function getAll(key: string): string[] {
    const val = searchParams.get(key);
    if (!val) return [];
    return val.split(",").map(s => s.trim()).filter(Boolean);
  }

  function set(updates: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (resetPage && !("page" in updates)) {
      params.delete("page");
    }
    setSearchParams(params);
  }

  return { get, getAll, set, searchParams };
}
