import { useEffect, useState } from "react";
import { request } from "./commerce";
import { AppIcon } from "./AppIcon";
import { iconRegistry } from "./icon-registry";
import { availableIconNames } from "./icon-names";
import { defaultIconPools, type IconPools, type IconPool } from "./icon-pools";
export default function IconSettings({
  company,
  canManage,
  onDirty,
}: {
  company: string;
  canManage: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const [pools, setPools] = useState<IconPools>({}),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("Todos"),
    [picker, setPicker] = useState<{ key: string; index?: number } | null>(
      null,
    ),
    [query, setQuery] = useState(""),
    [count, setCount] = useState(40);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setReady(false);
    setDirty(false);
    setError("");
    setPicker(null);
    request("company_icon_pools", { p_company: company })
      .then((r) => {
        if (live) {
          setPools(r || {});
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
    onDirty(dirty || busy);
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      onDirty(false);
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty, busy, onDirty]);
  const editable = canManage && ready && !busy;
  function update(key: string, pool: IconPool) {
    setPools((old) => ({ ...old, [key]: pool }));
    setDirty(true);
    setNotice("");
    setError("");
  }
  function choose(name: string) {
    if (!picker) return;
    const pool = pools[picker.key] || defaultIconPools[picker.key],
      options = [...pool.options];
    if (options.some((n, i) => n === name && i !== picker.index)) {
      setError("Ese icono ya está en el pool.");
      return;
    }
    let active = pool.active;
    if (picker.index === undefined) {
      if (options.length >= 5) return;
      options.push(name);
    } else {
      if (active === options[picker.index]) active = name;
      options[picker.index] = name;
    }
    update(picker.key, { options, active });
    setPicker(null);
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const filtered = iconRegistry.filter(
    (e) =>
      (category === "Todos" || e.category === category) &&
      norm(
        [e.label, e.key, e.category, ...(pools[e.key]?.options || [])].join(
          " ",
        ),
      ).includes(norm(search)),
  );
  const categories = [...new Set(iconRegistry.map((e) => e.category))];
  const aliases: Record<string, string> = {
    guardar: "save",
    buscar: "search",
    casa: "house",
    empresa: "building",
    editar: "pen",
    eliminar: "trash",
    comprar: "shopping",
    fabricar: "factory",
    archivo: "archive",
    flecha: "arrow",
    activo: "check",
  };
  const term = norm(query).trim().replaceAll(" ", "-"),
    pool = picker ? pools[picker.key] || defaultIconPools[picker.key] : null;
  const found = availableIconNames.filter(
    (n) =>
      n.includes(aliases[term] || term) &&
      !pool?.options.some((old, i) => old === n && i !== picker?.index),
  );
  if (loading) return <p role="status">Cargando pools de iconos…</p>;
  return (
    <section className="icon-settings" aria-busy={busy}>
      <div className="hierarchy-toolbar">
        <div>
          <h3>Pools de iconos por empresa</h3>
          <p className="muted">
            Hasta cinco opciones por función. El resaltado es el icono activo;
            los colores de estado se conservan.
          </p>
        </div>
        <button
          className="secondary"
          disabled={!editable}
          onClick={() => {
            if (
              confirm(
                "¿Restaurar todos los pools predeterminados? Los cambios se aplicarán al guardar.",
              )
            ) {
              setPools(structuredClone(defaultIconPools));
              setDirty(true);
              setNotice("");
            }
          }}
        >
          Restaurar todos
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="settings-grid">
        <label>
          Buscar función o icono
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Activo, compras, guardar…"
          />
        </label>
        <label>
          Categoría
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["Todos", ...categories].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {categories.map((c) => {
        const entries = filtered.filter((e) => e.category === c);
        return (
          entries.length > 0 && (
            <section className="icon-pool-category" key={c}>
              <h4>{c}</h4>
              <div className="icon-pool-list">
                {entries.map((e) => {
                  const p = pools[e.key] || defaultIconPools[e.key];
                  return (
                    <div
                      className={
                        "icon-pool-row pool-" + e.key.replaceAll(".", "-")
                      }
                      key={e.key}
                    >
                      <div className="icon-pool-label">
                        <strong>{e.label}</strong>
                        <small>{e.key}</small>
                      </div>
                      <div className="icon-pool-options">
                        {p.options.map((name, i) => (
                          <div className="icon-pool-option" key={name}>
                            <button
                              type="button"
                              className={
                                "secondary icon-pool-choice " +
                                (p.active === name ? "is-active" : "")
                              }
                              title={
                                name + (p.active === name ? " · Activo" : "")
                              }
                              aria-label={
                                "Activar " + name + " para " + e.label
                              }
                              aria-pressed={p.active === name}
                              disabled={!editable}
                              onClick={() => {
                                if (p.active !== name)
                                  update(e.key, { ...p, active: name });
                              }}
                            >
                              <AppIcon name={e.key} override={name} />
                            </button>
                            <div className="icon-pool-tools">
                              <button
                                type="button"
                                className="secondary"
                                disabled={!editable}
                                title="Reemplazar opción"
                                aria-label={
                                  "Reemplazar " + name + " de " + e.label
                                }
                                onClick={() => {
                                  setPicker({ key: e.key, index: i });
                                  setQuery("");
                                  setCount(40);
                                }}
                              >
                                <AppIcon name="action.edit" />
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={!editable || p.options.length === 1}
                                title="Quitar opción"
                                aria-label={"Quitar " + name + " de " + e.label}
                                onClick={() => {
                                  const options = p.options.filter(
                                    (_, index) => index !== i,
                                  );
                                  update(e.key, {
                                    options,
                                    active:
                                      p.active === name ? options[0] : p.active,
                                  });
                                }}
                              >
                                <AppIcon name="action.delete" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="icon-pool-controls">
                        <button
                          className="secondary"
                          disabled={!editable || p.options.length >= 5}
                          onClick={() => {
                            setPicker({ key: e.key });
                            setQuery("");
                            setCount(40);
                          }}
                        >
                          Agregar
                        </button>
                        <button
                          className="secondary"
                          disabled={!editable}
                          onClick={() =>
                            update(
                              e.key,
                              structuredClone(defaultIconPools[e.key]),
                            )
                          }
                        >
                          Restaurar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )
        );
      })}
      {!filtered.length && (
        <p>No hay funciones que coincidan con la búsqueda.</p>
      )}
      <div className="icon-pool-save">
        <button
          disabled={!editable || !dirty}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await request("save_company_icons", {
                p_company: company,
                p_icons: pools,
              });
              setDirty(false);
              setNotice("Pools e iconos activos guardados para esta empresa.");
              window.dispatchEvent(new Event("ohana-icons-saved"));
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar iconos
        </button>
        {dirty && <span role="status">Cambios sin guardar</span>}
      </div>
      {picker && (
        <div className="overlay" style={{ zIndex: 10001 }}>
          <section
            className="modal operations-dialog icon-selector"
            role="dialog"
            aria-modal="true"
            aria-label="Elegir opción del pool"
          >
            <div className="hierarchy-toolbar">
              <h3>
                {picker.index === undefined ? "Agregar" : "Reemplazar"} icono ·{" "}
                {iconRegistry.find((e) => e.key === picker.key)?.label}
              </h3>
              <button className="secondary" onClick={() => setPicker(null)}>
                Cerrar
              </button>
            </div>
            <label>
              Buscar icono Lucide
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCount(40);
                }}
                placeholder="search, package, check…"
              />
            </label>
            <p>
              {found.length} opciones válidas. Se excluyen los iconos ya
              incluidos en este pool.
            </p>
            <div className="icon-gallery">
              {found.slice(0, count).map((name) => (
                <button
                  type="button"
                  className="secondary"
                  key={name}
                  title={name}
                  onClick={() => choose(name)}
                >
                  <AppIcon name={picker.key} override={name} />
                  <small>{name}</small>
                </button>
              ))}
            </div>
            {found.length > count && (
              <button
                className="secondary"
                onClick={() => setCount(count + 40)}
              >
                Mostrar más
              </button>
            )}
            <small>
              Lucide · licencia ISC. Se descargan únicamente los iconos
              mostrados.
            </small>
          </section>
        </div>
      )}
    </section>
  );
}
