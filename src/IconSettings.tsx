import SearchSelect from "./SearchSelect";
import { confirmAction } from "./ConfirmDialog";
import { AppButton } from "./AppIcon";
import { IconDetails, SearchField } from "./PoolControls";
import { useEffect, useState } from "react";
import { request } from "./commerce";
import { AppIcon, notifyIconsChanged } from "./AppIcon";
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
  const [selected, setSelected] = useState<Record<string, string>>({});
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
    setSelected({});
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
    if (!picker || !editable) return;
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
    setSelected(previous => ({ ...previous, [picker.key]: name }));
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
        [e.label, e.key, e.category, ...((pools[e.key] || defaultIconPools[e.key])?.options || [])].join(
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
  if (loading) return <p role="status">Cargando iconos…</p>;
  return (
    <section className="icon-settings" aria-busy={busy}>
      <div className="hierarchy-toolbar">
        <div>
          <h3>Iconos por empresa</h3>
          <p className="muted">Selecciona el icono activo para cada función. Puedes administrar hasta cinco alternativas por función.</p>
        </div>
        <AppButton
          type="button" className="secondary catalog-icon-button" iconKey="action.refresh"
          aria-label="Restaurar todos los iconos" title="Restaurar todos los iconos"
          disabled={!editable}
          onClick={async () => {
            if (
              await confirmAction(
                "¿Restaurar todos los pools predeterminados? Los cambios se aplicarán al guardar.",
              )
            ) {
              setPools(structuredClone(defaultIconPools));
              setSelected({});
              setDirty(true);
              setNotice("");
            }
          }}
        />
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
          <SearchField
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Activo, compras, guardar…"
          />
        </label>
        <label>
          Categoría
          <SearchSelect
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["Todos", ...categories].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SearchSelect>
        </label>
      </div>
      {categories.map(c => {
        const entries = filtered.filter(e => e.category === c);
        return <IconDetails className="icon-pool-category compact-icon-category" key={c} hidden={!entries.length}>
          <summary>{c}</summary>
          <div className="icon-pool-list">
            {entries.map(e => {
              const pool = pools[e.key] || defaultIconPools[e.key];
              const chosen = selected[e.key];
              const index = pool.options.indexOf(chosen);
              function openPicker(index?: number) {
                setPicker({ key: e.key, index });
                setQuery("");
                setCount(40);
              }
              return <article className={"icon-pool-row pool-" + e.key.replaceAll(".", "-")} key={e.key}>
                <div className="icon-pool-label">
                  <strong>{e.label}</strong>
                  <small>{e.key}</small>
                </div>
                <AppButton type="button" className="secondary catalog-icon-button icon-pool-restore" iconKey="action.refresh"
                  aria-label={"Restaurar iconos de " + e.label} title={"Restaurar iconos de " + e.label}
                  disabled={!editable}
                  onClick={async () => {
                    if (!(await confirmAction(`¿Restaurar los iconos predeterminados de «${e.label}»? Los cambios se aplicarán al guardar.`))) return;
                    update(e.key, structuredClone(defaultIconPools[e.key]));
                    setSelected(previous => ({ ...previous, [e.key]: "" }));
                  }} />
                <div className="icon-pool-options" role="group" aria-label={"Alternativas de " + e.label}>
                  {pool.options.map(name => <AppButton
                    type="button" className={"secondary icon-pool-choice" + (pool.active === name ? " is-active" : "")}
                    aria-pressed={name === chosen} data-managing={name === chosen || undefined}
                    aria-label={name + (pool.active === name ? " · activo" : "")}
                    title={name + (pool.active === name ? " · activo" : "")}
                    disabled={!editable} key={name} onClick={() => setSelected(previous => ({ ...previous, [e.key]: name }))}>
                    <AppIcon name={e.key} override={name} />
                    {pool.active === name && <small>Activo</small>}
                  </AppButton>)}
                </div>
                <div className="icon-pool-selection">
                  <small>{index < 0 ? "Selecciona una alternativa para administrarla." : `Seleccionada: ${chosen}`}</small>
                  <AppButton type="button" className="secondary" iconKey="action.confirm"
                    disabled={!editable || index < 0 || pool.active === chosen}
                    onClick={() => update(e.key, { ...pool, active: chosen })}>Usar icono</AppButton>
                </div>
                <div className="icon-pool-controls" role="group" aria-label={"Administrar alternativas de " + e.label}>
                  <AppButton type="button" className="secondary" iconKey="action.add"
                    disabled={!editable || pool.options.length >= 5} onClick={() => openPicker()}>Agregar alternativa</AppButton>
                  <AppButton type="button" className="secondary" iconKey="action.edit"
                    disabled={!editable || index < 0} onClick={() => openPicker(index)}>Editar seleccionada</AppButton>
                  <AppButton type="button" className="secondary" iconKey="action.delete"
                    disabled={!editable || index < 0 || pool.options.length === 1}
                    onClick={async () => {
                      if (!(await confirmAction(`¿Quitar «${chosen}» de «${e.label}»? Los cambios se aplicarán al guardar.`))) return;
                      const options = pool.options.filter(name => name !== chosen);
                      update(e.key, { options, active: pool.active === chosen ? options[0] : pool.active });
                      setSelected(previous => ({ ...previous, [e.key]: "" }));
                    }}>Eliminar seleccionada</AppButton>
                </div>
              </article>;
            })}
          </div>
        </IconDetails>;
      })}
      {!filtered.length && (
        <p>No hay funciones que coincidan con la búsqueda.</p>
      )}
      <div className="icon-pool-save">
        <AppButton
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
              notifyIconsChanged(company);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar iconos
        </AppButton>
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
              <AppButton className="secondary" onClick={() => setPicker(null)}>
                Cerrar
              </AppButton>
            </div>
            <label>
              Buscar icono Lucide
              <SearchField
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
                <AppButton
                  type="button"
                  className="secondary"
                  key={name}
                  title={name}
                  onClick={() => choose(name)}
                >
                  <AppIcon name={picker.key} override={name} />
                  <small>{name}</small>
                </AppButton>
              ))}
            </div>
            {found.length > count && (
              <AppButton
                className="secondary"
                onClick={() => setCount(count + 40)}
              >
                Mostrar más
              </AppButton>
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
