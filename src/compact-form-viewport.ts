import { useEffect, type RefObject } from "react";

export function useCompactFormViewport(body: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    function keepFocusedFieldVisible() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLElement) || !body.current?.contains(field)) return;
        const dialog = body.current.closest(".compact-form-dialog");
        if (!dialog) return;
        const bounds = dialog.getBoundingClientRect();
        const header = dialog.querySelector(".compact-form-header")?.getBoundingClientRect();
        const footer = dialog.querySelector(".compact-form-actions")?.getBoundingClientRect();
        const target = field.getBoundingClientRect();
        const top = Math.max(bounds.top, header?.bottom ?? bounds.top);
        const bottom = Math.min(bounds.bottom, footer?.top ?? bounds.bottom);
        if (target.top < top) dialog.scrollBy({ top: target.top - top - 8 });
        else if (target.bottom > bottom) dialog.scrollBy({ top: target.bottom - bottom + 8 });
      });
    }
    viewport?.addEventListener("resize", keepFocusedFieldVisible);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", keepFocusedFieldVisible);
    };
  }, [body]);
}

export function scrollCompactFormToStart(body: HTMLDivElement | null) {
  body?.closest(".compact-form-dialog")?.scrollTo({ top: 0 });
}
