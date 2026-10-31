import { useEffect, useRef } from "react";
import MaterialSheet from "./MaterialSheet";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof MaterialSheet>, "mode">;
export default function ImportMaterials(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="bulk-import-dialog"
      aria-label="Copiar de Tabla"
      onCancel={(e) => {
        e.preventDefault();
        dialog.current
          ?.querySelector<HTMLButtonElement>("[data-cancel-import]")
          ?.click();
      }}
    >
      <MaterialSheet {...props} mode="import" />
    </dialog>
  );
}
