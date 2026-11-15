import { useState } from "react";
import type { ReactNode } from "react";

export default function TableActions({ primary, secondary }: {
  primary: ReactNode;
  secondary: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <>
    {primary}
    <button type="button" className="mobile-more-actions secondary" aria-expanded={open}
      onClick={() => setOpen(!open)}>
      {open ? "Menos acciones" : "Más acciones"}
    </button>
    <span className="table-secondary-actions" data-open={open}>{secondary}</span>
  </>;
}
