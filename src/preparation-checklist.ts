import { useState } from "react";

function readMarks(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function usePreparationChecklist(scope: string) {
  const key = "ohana.preparation." + scope;
  const [memory, setMemory] = useState(() => ({ key, marks: readMarks(key) }));
  const marks = memory.key === key ? memory.marks : readMarks(key);
  function save(next: Set<string>) {
    try {
      if (next.size) localStorage.setItem(key, JSON.stringify([...next]));
      else localStorage.removeItem(key);
    } catch {
      // The checklist can still be used during this visit.
    }
    setMemory({ key, marks: next });
  }
  return {
    marks,
    mark(ids: string[], checked: boolean) {
      const next = new Set(marks);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      save(next);
    },
    clear() { save(new Set()); },
  };
}
