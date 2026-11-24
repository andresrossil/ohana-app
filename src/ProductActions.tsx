import { useId, useRef } from "react";
import { EllipsisVertical } from "lucide-react";
import { AppButton } from "./AppIcon";

export default function ProductActions({ name, onEdit, onBarcode }: {
  name: string;
  onEdit?: () => void;
  onBarcode?: () => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);

  function choose(action: () => void) {
    menu.current?.hidePopover();
    action();
  }

  return <>
    <button type="button" className="secondary catalog-icon-button" popoverTarget={id}
      aria-label={`Acciones de ${name}`} title="Acciones"
      onClick={event => {
        const panel = menu.current;
        if (!panel) return;
        const anchor = event.currentTarget.getBoundingClientRect();
        const below = anchor.bottom + 5;
        const needed = 18 + 48 * (Number(Boolean(onEdit)) + Number(Boolean(onBarcode)));
        panel.style.top = `${below + needed <= window.innerHeight ? below : Math.max(0, anchor.top - needed)}px`;
        panel.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
      }}>
      <EllipsisVertical size={18} aria-hidden="true" />
    </button>
    <div id={id} ref={menu} popover="auto" className="dashboard-surface product-actions-menu">
      {onEdit && <AppButton type="button" className="secondary" iconKey="action.edit" onClick={() => choose(onEdit)}>Editar</AppButton>}
      {onBarcode && <AppButton type="button" className="secondary" iconKey="action.barcode"
        onClick={() => choose(onBarcode)}>Código de barras</AppButton>}
    </div>
  </>;
}
