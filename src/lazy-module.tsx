import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
  type ComponentProps,
} from "react";
import { AppButton } from "./AppIcon";
export function lazyWithRecovery<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): ComponentType<ComponentProps<T>> {
  let cached: T | undefined, pending: Promise<{ default: T }> | undefined;
  const load = () => {
    if (cached) return Promise.resolve({ default: cached });
    pending ??= loader()
      .then((module) => {
        cached = module.default;
        return module;
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
  return function RecoverableModule(props: ComponentProps<T>) {
    const [Loaded, setLoaded] = useState<T | undefined>(() => cached),
      [failed, setFailed] = useState(false),
      [attempt, setAttempt] = useState(0);
    useEffect(() => {
      let live = true;
      setFailed(false);
      void load()
        .then((module) => {
          if (live) setLoaded(() => module.default);
        })
        .catch(() => {
          if (live) {
            setFailed(true);
            window.dispatchEvent(new Event("ohana-module-load-error"));
          }
        });
      return () => {
        live = false;
      };
    }, [attempt]);
    if (Loaded) return createElement(Loaded, props);
    return failed ? (
      <section className="catalog" role="alert">
        <p>
          No se pudo abrir esta sección. Reintenta la carga sin recargar toda la
          aplicación.
        </p>
        <AppButton
          className="secondary"
          iconKey="action.refresh"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Reintentar carga
        </AppButton>
      </section>
    ) : (
      <p role="status">Abriendo sección…</p>
    );
  };
}
