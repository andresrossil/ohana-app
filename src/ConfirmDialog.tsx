import { useEffect, useRef, useState, useId } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import "./confirm-dialog.css";
type Options = {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  iconKey?: string;
  danger?: boolean;
  busyCheck?: () => boolean;
};
type Request = Options & {
  message: string;
  id: number;
  resolve: (value: boolean) => void;
  source: Element | null;
};
let listener: ((request: Request) => void) | null = null,
  nextId = 0;
const outstanding = new Set<Request>();
export function confirmAction(
  message: string,
  options: Options = {},
): Promise<boolean> {
  if (!listener) return Promise.resolve(false);
  const source = document.activeElement;
  if (
    [...outstanding].some((r) => r.message === message && r.source === source)
  )
    return Promise.resolve(false);
  const discard = /sin guardar|descart/i.test(message),
    destructive =
      discard || /eliminar|borrar|archivar|desactivar/i.test(message);
  return new Promise((resolve) => {
    const request: Request = {
      title: discard ? "Cambios sin guardar" : "Confirmar acción",
      confirmText: discard
        ? "Salir sin guardar"
        : /restaurar/i.test(message)
          ? "Restaurar"
          : /desactivar/i.test(message)
            ? "Desactivar"
            : /archivar/i.test(message)
              ? "Archivar"
              : /eliminar|borrar/i.test(message)
                ? "Eliminar"
                : "Confirmar",
      cancelText: "Cancelar",
      iconKey: discard || destructive ? "status.warning" : "action.confirm",
      danger: destructive,
      ...options,
      message,
      id: ++nextId,
      resolve,
      source,
    };
    outstanding.add(request);
    listener?.(request);
  });
}
export function ConfirmDialog({
  title = "Confirmar acción",
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  iconKey = "action.confirm",
  danger = false,
  busyCheck,
  onCancel,
  onConfirm,
}: { message: string; onCancel: () => void; onConfirm: () => void } & Options) {
  const titleId = useId(),
    messageId = useId(),
    ref = useRef<HTMLElement>(null),
    [, refresh] = useState(0);
  const blocked = busyCheck?.() || false;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>("[data-confirm-cancel]")
      ?.focus();
    const updated = () => refresh((n) => n + 1);
    window.addEventListener("ohana-operation-finished", updated);
    return () => {
      window.removeEventListener("ohana-operation-finished", updated);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="overlay confirm-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        ref={ref}
        className={
          "modal confirm-dialog " + (danger ? "confirm-destructive" : "")
        }
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
          if (e.key === "Tab") {
            const controls = [
              ...(ref.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) || []),
            ];
            if (!controls.length) return;
            const first = controls[0],
              last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id={titleId}>
          <AppIcon name={iconKey} />
          {title}
        </h2>
        <p id={messageId}>
          {blocked
            ? "Hay una operación en curso. Espera a que termine antes de salir."
            : message}
        </p>
        <div className="form-actions">
          <AppButton
            type="button"
            className="secondary"
            iconKey="action.cancel"
            data-confirm-cancel
            onClick={onCancel}
          >
            {cancelText}
          </AppButton>
          <AppButton
            type="button"
            className={danger ? "danger" : ""}
            disabled={blocked}
            onClick={() => {
              if (!busyCheck?.()) onConfirm();
            }}
          >
            {confirmText}
          </AppButton>
        </div>
      </section>
    </div>
  );
}
export function ConfirmHost() {
  const [queue, setQueue] = useState<Request[]>([]),
    owned = useRef(new Set<Request>());
  useEffect(() => {
    const receive = (request: Request) => {
      owned.current.add(request);
      setQueue((q) => [...q, request]);
    };
    listener = receive;
    return () => {
      if (listener === receive) listener = null;
      for (const request of owned.current) {
        outstanding.delete(request);
        request.resolve(false);
      }
      owned.current.clear();
    };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const finish = (value: boolean) => {
    owned.current.delete(current);
    outstanding.delete(current);
    setQueue((q) => q.filter((r) => r !== current));
    current.resolve(value);
  };
  return (
    <ConfirmDialog
      key={current.id}
      {...current}
      onCancel={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  );
}
