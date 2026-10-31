import { useEffect, useState, lazy, Suspense } from "react";
import { request } from "./commerce";
import { AppIcon } from "./AppIcon";
import { iconRegistry } from "./icon-registry";
import { availableIconNames } from "./icon-names";
const Dynamic = lazy(() => import("./LucideDynamic"));
export default function IconSettings({
  company,
  canManage,
  onDirty,
}: {
  company: string;
  canManage: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const [icons, setIcons] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [entry, setEntry] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("Todos"),
    [count, setCount] = useState(80);
  useEffect(() => {
    let live = true;
    request("company_icons", { p_company: company })
      .then((r) => {
        if (live) {
          setIcons(r || {});
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      onDirty(false);
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty, onDirty]);
  const groups: Record<string, RegExp> = {
    Navegación: /arrow|chevron|menu|compass|navigation|house/,
    Personas: /user|person|contact|hand/,
    Comercio: /cart|store|shop|package|box|barcode|wallet|credit|bank/,
    Archivos: /file|folder|save|download|upload|printer/,
    Estados: /alert|circle|check|info|clock|bell/,
    Naturaleza: /flower|leaf|tree|sun|moon|cloud|sprout|heart/,
  };
  const aliases: Record<string, string> = {
    flor: "flower",
    guardar: "save",
    cancelar: "x",
    editar: "pencil",
    eliminar: "trash",
    agregar: "plus",
    buscar: "search",
    usuario: "user",
    empresa: "building",
    casa: "house",
    caja: "package",
    inventario: "warehouse",
    produccion: "factory",
    flecha: "arrow",
    impresora: "printer",
    historial: "history",
    calculadora: "calculator",
    hoja: "leaf",
    corazon: "heart",
  };
  const term = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replaceAll(" ", "-");
  const found = availableIconNames.filter(
    (n) =>
      n.includes(aliases[term] || term) &&
      (category === "Todos" || groups[category]?.test(n)),
  );
  function update(next: Record<string, string>) {
    setIcons(next);
    setDirty(true);
    setNotice("");
  }
  const editable = canManage && ready;
  if (loading) return <p role="status">Cargando íconos de la empresa…</p>;
  return (
    <section className="icon-settings">
      <div className="hierarchy-toolbar">
        <div>
          <h3>Íconos de la empresa</h3>
          <p className="muted">
            Personaliza módulos y acciones. Los textos y las confirmaciones se
            conservan.
          </p>
        </div>
        <button
          className="secondary"
          disabled={!editable || busy}
          onClick={() => {
            if (
              confirm(
                "¿Restaurar todos los íconos predeterminados? Tendrás que guardar los cambios.",
              )
            )
              update({});
          }}
        >
          Restaurar todos
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="icon-assignments">
        {iconRegistry.map((e) => (
          <div className="icon-assignment" key={e.key}>
            <AppIcon name={e.key} override={icons[e.key] || e.icon} />
            <div>
              <strong>{e.label}</strong>
              <small>
                {e.key} · {icons[e.key] || e.icon}
              </small>
            </div>
            <button
              className="secondary"
              disabled={!editable || e.locked}
              onClick={() => {
                setEntry(e.key);
                setQuery("");
                setCategory("Todos");
                setCount(80);
              }}
            >
              {e.locked ? "Señal fija" : "Cambiar"}
            </button>
            <button
              className="secondary"
              disabled={!editable || !icons[e.key] || e.locked}
              onClick={() => {
                const next = { ...icons };
                delete next[e.key];
                update(next);
              }}
            >
              Restaurar
            </button>
          </div>
        ))}
      </div>
      {dirty && <p role="status">Tienes cambios de íconos sin guardar.</p>}
      <button
        disabled={!editable || !dirty || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await request("save_company_icons", {
              p_company: company,
              p_icons: icons,
            });
            setDirty(false);
            setNotice("Íconos guardados para esta empresa.");
            window.dispatchEvent(new Event("ohana-icons-saved"));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Guardar íconos
      </button>
      {entry && (
        <div className="overlay">
          <section
            className="modal operations-dialog icon-selector"
            role="dialog"
            aria-modal="true"
            aria-label="Seleccionar ícono"
          >
            <div className="hierarchy-toolbar">
              <h3>
                Ícono para {iconRegistry.find((e) => e.key === entry)?.label}
              </h3>
              <button className="secondary" onClick={() => setEntry(null)}>
                Cerrar
              </button>
            </div>
            <div className="settings-grid">
              <label>
                Buscar por nombre de Lucide
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCount(80);
                  }}
                  placeholder="search, flower, package…"
                />
              </label>
              <label>
                Categoría
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCount(80);
                  }}
                >
                  {["Todos", ...Object.keys(groups)].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              {found.length} íconos disponibles. Selecciona uno para ver el
              cambio en la lista.
            </p>
            <div className="icon-gallery">
              {found.slice(0, count).map((name) => (
                <button
                  type="button"
                  className="secondary"
                  key={name}
                  title={name}
                  aria-label={"Seleccionar " + name}
                  onClick={() => {
                    update({ ...icons, [entry]: name });
                    setEntry(null);
                  }}
                >
                  <Suspense fallback={<span className="icon-placeholder" />}>
                    <Dynamic name={name} />
                  </Suspense>
                  <small>{name}</small>
                </button>
              ))}
            </div>
            {found.length > count && (
              <button
                className="secondary"
                onClick={() => setCount(count + 80)}
              >
                Mostrar más
              </button>
            )}
            <small>
              Lucide · licencia ISC. Los archivos de íconos se distribuyen con
              la aplicación, no se guardan en Supabase.
            </small>
          </section>
        </div>
      )}
    </section>
  );
}
