import { useEffect, useState } from "react";
import { useApp } from "./app-context";

// Keep administrative filters when moving between sections, scoped to this account.
export function useFilter(name: string, initial: string, explicit = false) {
  const { user } = useApp();
  const key = `fa-filter:${user.id}:${name}`;
  const [value, setValue] = useState<string>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (!explicit && stored !== null) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === typeof initial) return parsed;
      }
    } catch {}
    return initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
