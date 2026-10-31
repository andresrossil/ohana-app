import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState, lazy, Suspense } from "react";
const GlobalAdmin = lazy(() => import("./GlobalAdmin"));
import type { FormEvent } from "react";
import { supabase as db } from "./client";
import type { CatalogRow } from "./sheet-model";
const modules = [
  ["catalog", "Catálogo"],
  ["inventory", "Compras e inventario"],
  ["production", "Fórmulas y producción"],
  ["sales", "Clientes y ventas"],
  ["reports", "Reportes"],
];
function ModuleAccess({
  member,
  company,
  onSaved,
}: {
  member: CatalogRow;
  company: string;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState(() =>
      modules.map(
        ([module]) =>
          member.modules.find((m: any) => m.module === module) || {
            module,
            read: module === "catalog",
            write: module === "catalog" && member.role === "editor",
          },
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details>
      <summary>Módulos de {member.email}</summary>
      <div className="module-access">
        {values.map((v: any, i: number) => (
          <div key={v.module}>
            <strong>{modules[i][1]}</strong>
            <label className="check-label">
              <input
                type="checkbox"
                checked={v.read}
                onChange={(e) =>
                  setValues(
                    values.map((m: any, n: number) =>
                      n === i
                        ? {
                            ...m,
                            read: e.target.checked,
                            write: e.target.checked && m.write,
                          }
                        : m,
                    ),
                  )
                }
              />
              Consultar
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={v.write}
                onChange={(e) =>
                  setValues(
                    values.map((m: any, n: number) =>
                      n === i
                        ? {
                            ...m,
                            write: e.target.checked,
                            read: m.read || e.target.checked,
                          }
                        : m,
                    ),
                  )
                }
              />
              Editar
            </label>
          </div>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      <AppButton
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await db.rpc("set_member_modules", {
            p_company: company,
            p_user: member.id,
            p_modules: values,
          });
          if (error) setError(error.message);
          else await onSaved();
          setBusy(false);
        }}
      >
        Guardar módulos
      </AppButton>
    </details>
  );
}
function Members({
  company,
  corporation,
}: {
  company?: string;
  corporation?: string;
}) {
  const [members, setMembers] = useState<CatalogRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    const { data, error } = await db.rpc("list_members", {
      p_company: company || null,
      p_corporation: corporation || null,
    });
    if (error) setError(error.message);
    else setMembers(data || []);
  }
  useEffect(() => {
    void load();
  }, [company, corporation]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { error } = await db.rpc("assign_member", {
      p_company: company || null,
      p_corporation: corporation || null,
      p_email: String(f.get("email")),
      p_role: String(f.get("role")),
    });
    if (error) setError(error.message);
    else {
      setNotice("Acceso actualizado.");
      await load();
    }
    setBusy(false);
  }
  return (
    <section>
      <h3>
        {corporation
          ? "Administradores de corporación"
          : "Usuarios de la empresa"}
      </h3>
      <p className="muted">
        La cuenta debe registrarse y verificar el correo. No puedes modificar
        tus propios permisos.
      </p>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={save}>
        <label>
          Correo de la cuenta
          <input type="email" name="email" required />
        </label>
        <label>
          Acceso
          <select name="role">
            {corporation ? (
              <>
                <option value="corporation_admin">
                  Administrador de corporación
                </option>
                <option value="remove_corporation">
                  Retirar acceso a la corporación
                </option>
              </>
            ) : (
              <>
                <option value="viewer">
                  Usuario operativo · consulta de catálogo
                </option>
                <option value="editor">
                  Usuario operativo · edición de catálogo
                </option>
                <option value="admin">Administrador de empresa</option>
                <option value="remove">Retirar acceso a esta empresa</option>
              </>
            )}
          </select>
        </label>
        <AppButton disabled={busy}>Aplicar acceso</AppButton>
      </form>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id}>
            <strong>{m.email}</strong>
            <p className="muted">
              {m.role === "corporation_admin"
                ? "Administrador de corporación"
                : m.role === "admin"
                  ? "Administrador de empresa"
                  : "Usuario operativo"}
              {m.self ? " · Tu cuenta" : ""}
            </p>
            {company && !m.self && m.role !== "admin" && (
              <ModuleAccess
                key={m.id + JSON.stringify(m.modules)}
                member={m}
                company={company}
                onSaved={load}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function OrganizationAdmin({
  companies,
  corporations,
  canCreate,
  onSaved,
  onConfigure,
}: {
  companies: CatalogRow[];
  corporations: CatalogRow[];
  canCreate: boolean;
  onSaved: () => Promise<void>;
  onConfigure?: (id: string) => void;
}) {
  const [searchCollapsed, setSearchCollapsed] = useState<
      Record<string, boolean>
    >({}),
    [query, setQuery] = useState(""),
    [dialog, setDialog] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
      try {
        return JSON.parse(sessionStorage.getItem("ohana.hierarchy") || "{}");
      } catch {
        return {};
      }
    });
  const groups = [...corporations];
  for (const c of companies)
    if (c.corporation_id && !groups.some((g) => g.id === c.corporation_id))
      groups.push({
        id: c.corporation_id,
        name: c.corporation_name || "Corporación",
        manage: false,
      });
  function open(value: any) {
    setError("");
    setDirty(false);
    setDialog(value);
  }
  function close() {
    if (busy) return;
    if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
    setDialog(null);
  }
  function toggle(id: string) {
    if (query.trim()) {
      setSearchCollapsed((old) => ({ ...old, [id]: !old[id] }));
      return;
    }
    setExpanded((old) => {
      const next = { ...old, [id]: !(old[id] ?? true) };
      try {
        sessionStorage.setItem("ohana.hierarchy", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("manage_structure", {
        p_action: dialog.type,
        p_id: dialog.row?.id || null,
        p_parent: dialog.parent || null,
        p_name: String(f.get("name") || ""),
        p_active: f.get("active") !== "false",
      });
      if (r.error) throw r.error;
      await onSaved();
      setDialog(null);
      setDirty(false);
      setNotice("Cambios guardados.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const q = query.trim().toLocaleLowerCase();
  return (
    <section className="admin-structure org-hierarchy">
      <Suspense fallback={null}>
        <GlobalAdmin />
      </Suspense>
      <div className="hierarchy-toolbar">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN AUTORIZADA</p>
          <h2>Corporaciones y accesos</h2>
        </div>
        {canCreate && (
          <AppButton
            onClick={() =>
              open({ type: "create_corporation", title: "Nueva corporación" })
            }
          >
            Nueva corporación
          </AppButton>
        )}
      </div>
      <label>
        Buscar corporación o empresa
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchCollapsed({});
          }}
          placeholder="Buscar por nombre…"
        />
      </label>
      {notice && <p role="status">{notice}</p>}
      {groups
        .filter(
          (g) =>
            g.name.toLocaleLowerCase().includes(q) ||
            companies.some(
              (c) =>
                c.corporation_id === g.id &&
                c.name.toLocaleLowerCase().includes(q),
            ),
        )
        .map((g) => {
          const children = companies.filter((c) => c.corporation_id === g.id),
            shown = children.filter(
              (c) =>
                g.name.toLocaleLowerCase().includes(q) ||
                c.name.toLocaleLowerCase().includes(q),
            ),
            isOpen = q ? !searchCollapsed[g.id] : (expanded[g.id] ?? true);
          return (
            <section className="corporation-node" key={g.id}>
              <div className="hierarchy-row">
                <AppButton
                  className="secondary tree-toggle"
                  aria-expanded={isOpen}
                  aria-label={(isOpen ? "Contraer " : "Expandir ") + g.name}
                  onClick={() => toggle(g.id)}
                >
                  <AppIcon
                    name={isOpen ? "action.collapse" : "action.expand"}
                  />
                </AppButton>
                <div className="tree-label">
                  <strong>{g.name}</strong>
                  <small>
                    {children.length} empresa(s) autorizada(s)
                    {g.active === false ? " · Inactiva" : ""}
                  </small>
                </div>
                <div className="tree-actions">
                  {g.manage && (
                    <>
                      <AppButton
                        className="secondary"
                        onClick={() =>
                          open({
                            type: "rename_corporation",
                            title: "Editar corporación",
                            row: g,
                          })
                        }
                      >
                        Editar
                      </AppButton>
                      <AppButton
                        className="secondary"
                        onClick={() =>
                          open({
                            type: "create_company",
                            title: "Agregar empresa a " + g.name,
                            parent: g.id,
                          })
                        }
                      >
                        Agregar empresa
                      </AppButton>
                      <AppButton
                        className="secondary"
                        onClick={() =>
                          open({
                            type: "access_corp",
                            title: "Accesos de " + g.name,
                            row: g,
                          })
                        }
                      >
                        Accesos
                      </AppButton>
                    </>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="company-branches">
                  {shown.map((c) => (
                    <div className="hierarchy-row company-node" key={c.id}>
                      <div className="tree-label">
                        <strong>{c.name}</strong>
                        <small>
                          {c.active !== false ? "Activa" : "Inactiva"}
                        </small>
                      </div>
                      <div className="tree-actions">
                        {c.manage && (
                          <>
                            <AppButton
                              className="secondary"
                              onClick={() =>
                                open({
                                  type: "edit_company",
                                  title: "Editar empresa",
                                  row: c,
                                })
                              }
                            >
                              Editar
                            </AppButton>
                            <AppButton
                              className="secondary"
                              onClick={() =>
                                open({
                                  type: "access_company",
                                  title: "Accesos de " + c.name,
                                  row: c,
                                })
                              }
                            >
                              Accesos
                            </AppButton>
                            {onConfigure && (
                              <AppButton
                                className="secondary"
                                disabled={c.active === false}
                                onClick={() => onConfigure(c.id)}
                              >
                                Configuración
                              </AppButton>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {!shown.length && (
                    <p className="muted">No hay empresas para mostrar.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      {!groups.length && <p>No tienes corporaciones o empresas asignadas.</p>}
      {groups.length > 0 &&
        q &&
        !groups.some(
          (g) =>
            g.name.toLocaleLowerCase().includes(q) ||
            companies.some(
              (c) =>
                c.corporation_id === g.id &&
                c.name.toLocaleLowerCase().includes(q),
            ),
        ) && <p>No se encontraron coincidencias.</p>}
      {dialog && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
          >
            <div className="hierarchy-toolbar">
              <h2>{dialog.title}</h2>
              {dialog.type.includes("company") && (
                <AppButton className="secondary" iconKey="action.back" disabled={busy} onClick={close}>
                  Volver a la corporación
                </AppButton>
              )}
              <AppButton className="secondary" disabled={busy} onClick={close}>
                Cerrar
              </AppButton>
            </div>
            {error && (
              <p role="alert" className="error">
                <AppIcon name="status.error" />
                {error}
              </p>
            )}
            {dialog.type.startsWith("access_") ? (
              <Members
                key={dialog.type + dialog.row.id}
                company={
                  dialog.type === "access_company" ? dialog.row.id : undefined
                }
                corporation={
                  dialog.type === "access_corp" ? dialog.row.id : undefined
                }
              />
            ) : (
              <form onSubmit={save} onChange={() => setDirty(true)}>
                <label>
                  Nombre
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={dialog.row?.name || ""}
                  />
                </label>
                {dialog.type === "edit_company" && (
                  <label>
                    Estado
                    <select
                      name="active"
                      defaultValue={String(dialog.row.active !== false)}
                    >
                      <option value="true">Activa</option>
                      <option value="false">Inactiva</option>
                    </select>
                  </label>
                )}
                <div className="form-actions">
                  <AppButton disabled={busy}>Guardar</AppButton>
                  <AppButton
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={close}
                  >
                    Cancelar
                  </AppButton>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
