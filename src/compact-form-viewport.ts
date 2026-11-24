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
        const fieldRect = field.getBoundingClientRect();
        const bodyRect = body.current.getBoundingClientRect();
        if (fieldRect.bottom > bodyRect.bottom || fieldRect.top < bodyRect.top) {
          field.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    }
    viewport?.addEventListener("resize", keepFocusedFieldVisible);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", keepFocusedFieldVisible);
    };
  }, [body]);
}
