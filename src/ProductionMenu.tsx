import "./action-menu.css";
import { useId, useRef, type ReactNode } from "react";
import { EllipsisVertical } from "lucide-react";

export default function ProductionMenu({ children, document }: { children: ReactNode; document: string }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  return <>
    <button type="button" className="secondary catalog-icon-button" popoverTarget={id}
      aria-label={`Acciones de ${document}`} title="Acciones"
      onClick={event => {
        const panel = menu.current;
        if (!panel) return;
        const anchor = event.currentTarget.getBoundingClientRect();
        const needed = 16 + 47 * panel.childElementCount;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        panel.style.top = `${anchor.bottom + needed + 5 <= viewportHeight
          ? anchor.bottom + 5
          : Math.max(4, anchor.top - needed)}px`;
        panel.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
      }}>
      <EllipsisVertical size={18} aria-hidden="true" />
    </button>
    <div id={id} ref={menu} popover="auto" className="dashboard-surface production-actions-menu"
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("button")) menu.current?.hidePopover();
      }}>
      {children}
    </div>
  </>;
}
