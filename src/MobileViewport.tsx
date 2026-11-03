import { useEffect } from "react";
export default function MobileViewport() {
  useEffect(() => {
    const view = window.visualViewport,
      root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = view?.height || window.innerHeight,
          top = view?.offsetTop || 0;
        root.style.setProperty("--ohana-vh", height + "px");
        root.style.setProperty("--ohana-vtop", top + "px");
        root.style.setProperty(
          "--ohana-keyboard-inset",
          Math.max(0, window.innerHeight - height - top) + "px",
        );
        if (window.innerWidth > 760) return;
        const field = document.activeElement as HTMLElement | null;
        if (
          field &&
          (/^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName) ||
            field.isContentEditable)
        ) {
          const rect = field.getBoundingClientRect();
          if (rect.bottom > top + height - 20 || rect.top < top + 12)
            field.scrollIntoView({
              block: "nearest",
              inline: "nearest",
              behavior: "auto",
            });
        }
      });
    };
    update();
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    return () => {
      cancelAnimationFrame(frame);
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
    };
  }, []);
  return null;
}
