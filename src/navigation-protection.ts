import { useEffect, useRef } from "react";
let operations = 0;
export function operationStarted() {
  operations++;
}
export function operationFinished(success: boolean) {
  operations = Math.max(0, operations - 1);
  window.dispatchEvent(
    new CustomEvent("ohana-operation-finished", { detail: { success } }),
  );
}
const snapshot = (form: HTMLFormElement) =>
  JSON.stringify(
    [...form.elements]
      .filter(
        (e) =>
          e instanceof HTMLInputElement ||
          e instanceof HTMLSelectElement ||
          e instanceof HTMLTextAreaElement,
      )
      .map((e) => {
        const x = e as HTMLInputElement;
        return [
          x.name,
          x.type,
          x.dataset.precisionValue ?? x.value,
          x.checked,
          x.files
            ? [...x.files].map((f) => [f.name, f.size, f.lastModified])
            : null,
        ];
      }),
  );
export function useNavigationProtection() {
  const forms = useRef(new Map<HTMLFormElement, string>()),
    submitted = useRef(new Set<HTMLFormElement>());
  useEffect(() => {
    const capture = (e: Event) => {
      const el = e.target as HTMLElement,
        f = el.closest?.(".shell form") as HTMLFormElement | null;
      if (f && !f.hasAttribute("data-dirty-managed") && !forms.current.has(f))
        forms.current.set(f, snapshot(f));
    };
    const submit = (e: Event) => {
      if (e.target instanceof HTMLFormElement) submitted.current.add(e.target);
    };
    const completed = (e: Event) => {
      if ((e as CustomEvent).detail.success) {
        for (const f of submitted.current)
          if (f.isConnected && forms.current.has(f))
            forms.current.set(f, snapshot(f));
      }
      submitted.current.clear();
    };
    document.addEventListener("focusin", capture, true);
    document.addEventListener("pointerdown", capture, true);
    document.addEventListener("submit", submit, true);
    window.addEventListener("ohana-operation-finished", completed);
    return () => {
      document.removeEventListener("focusin", capture, true);
      document.removeEventListener("pointerdown", capture, true);
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("ohana-operation-finished", completed);
    };
  }, []);
  return {
    busy: () =>
      operations > 0 ||
      !!document.querySelector(
        '.shell form[aria-busy="true"], .variant-sheet[aria-busy="true"]',
      ),
    dirty: () =>
      !!document.querySelector('[data-navigation-dirty="true"]') ||
      [...forms.current].some(([f, s]) => f.isConnected && snapshot(f) !== s),
    clear: () => {
      forms.current.clear();
      submitted.current.clear();
    },
  };
}
