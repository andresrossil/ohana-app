import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { IDLE_REFRESH_MS, idleRefreshReady } from "./idle-refresh";
export default function UpdateGuard({
  user,
  blocked,
}: {
  user?: string;
  blocked: () => boolean;
}) {
  const latest = useRef(blocked);
  latest.current = blocked;
  const activity = useRef(Date.now()),
    [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!user) return;
    let live = true,
      checking = false,
      version = false,
      lastRefresh = Date.now();
    activity.current = Date.now();
    const touch = () => {
      activity.current = Date.now();
    };
    const checkVersion = async () => {
      if (!import.meta.env.PROD || checking) return;
      checking = true;
      try {
        const response = await fetch(
          import.meta.env.BASE_URL + "version.json",
          { cache: "no-store", signal: AbortSignal.timeout(10000) },
        );
        if (!response.ok) return;
        const data = await response.json();
        if (
          live &&
          typeof data.id === "string" &&
          data.id !== import.meta.env.VITE_APP_VERSION
        )
          version = true;
      } catch {
        /* A temporary connection problem never reloads the page. */
      } finally {
        checking = false;
      }
    };
    const tick = () => {
      const now = Date.now();
      if (latest.current()) {
        activity.current = now;
        return;
      }
      if (
        document.visibilityState !== "visible" ||
        now - activity.current < IDLE_REFRESH_MS
      )
        return;
      if (idleRefreshReady(now, activity.current, lastRefresh, false)) {
        lastRefresh = now;
        window.dispatchEvent(new Event("ohana-idle-refresh"));
        void checkVersion();
      }
      if (version) setAvailable(true);
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "input",
      "scroll",
      "touchstart",
    ];
    for (const name of events)
      document.addEventListener(name, touch, { passive: true, capture: true });
    const timer = setInterval(tick, 1000);
    window.addEventListener("ohana-operation-finished", touch);
    window.addEventListener("ohana-module-load-error", checkVersion);
    return () => {
      live = false;
      clearInterval(timer);
      for (const name of events)
        document.removeEventListener(name, touch, true);
      window.removeEventListener("ohana-operation-finished", touch);
      window.removeEventListener("ohana-module-load-error", checkVersion);
    };
  }, [user]);
  return available ? (
    <ConfirmDialog
      title="Actualización disponible"
      message="Hay una nueva versión de Ohana. Puedes actualizar ahora o continuar trabajando. La página no se recargará automáticamente."
      confirmText="Actualizar ahora"
      cancelText="Seguir trabajando"
      iconKey="status.info"
      busyCheck={blocked}
      onCancel={() => {
        activity.current = Date.now();
        setAvailable(false);
      }}
      onConfirm={() => {
        if (!latest.current()) window.location.reload();
      }}
    />
  ) : null;
}
