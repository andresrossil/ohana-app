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
          {error}
        </p>
      )}
      <button
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
      </button>
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
        <button disabled={busy}>Aplicar acceso</button>
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
}: {
  companies: CatalogRow[];
  corporations: CatalogRow[];
  canCreate: boolean;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [scope, setScope] = useState(companies.find((c) => c.manage)?.id || "");
  async function action(
    e: FormEvent<HTMLFormElement>,
    type: string,
    id: string | null = null,
    parent: string | null = null,
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("manage_structure", {
        p_action: type,
        p_id: id,
        p_name: String(f.get("name") || ""),
        p_parent: parent,
        p_active: f.get("active") !== "false",
      });
      if (error) throw error;
      await onSaved();
      setNotice("Cambios guardados.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-structure">
      <Suspense fallback={null}>
        <GlobalAdmin />
      </Suspense>
      <p className="eyebrow">ADMINISTRACIÓN AUTORIZADA</p>
      <h2>Corporaciones y empresas</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="sheet-notice">
          {notice}
        </p>
      )}
      {canCreate && (
        <form
          className="settings-block"
          onSubmit={(e) => void action(e, "create_corporation")}
        >
          <h3>Nueva corporación</h3>
          <label>
            Nombre
            <input name="name" maxLength={120} required />
          </label>
          <button disabled={busy}>Crear corporación</button>
        </form>
      )}
      {corporations
        .filter((c) => c.manage)
        .map((c) => (
          <section className="settings-block" key={c.id}>
            <form onSubmit={(e) => void action(e, "rename_corporation", c.id)}>
              <h3>Corporación {c.name}</h3>
              <label>
                Nombre de la corporación
                <input
                  name="name"
                  defaultValue={c.name}
                  maxLength={120}
                  required
                />
              </label>
              <button disabled={busy}>Guardar nombre de corporación</button>
            </form>
            <form
              onSubmit={(e) => void action(e, "create_company", null, c.id)}
            >
              <h3>Nueva empresa de {c.name}</h3>
              <label>
                Nombre de la empresa
                <input name="name" maxLength={120} required />
              </label>
              <button disabled={busy}>Crear empresa</button>
            </form>
            <details>
              <summary>Administrar acceso a {c.name}</summary>
              <Members corporation={c.id} />
            </details>
          </section>
        ))}
      {companies
        .filter((c) => c.manage)
        .map((c) => (
          <form
            className="settings-block"
            key={c.id + c.name + c.active}
            onSubmit={(e) => void action(e, "edit_company", c.id)}
          >
            <h3>Empresa {c.name}</h3>
            <p className="muted">Corporación: {c.corporation_name}</p>
            <label>
              Nombre de la empresa
              <input
                name="name"
                defaultValue={c.name}
                required
                maxLength={120}
              />
            </label>
            <label>
              Estado
              <select name="active" defaultValue={String(c.active !== false)}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </label>
            <button disabled={busy}>Guardar empresa</button>
          </form>
        ))}
      <section className="settings-block">
        <label>
          Usuarios de la empresa
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Seleccionar</option>
            {companies
              .filter((c) => c.manage)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {scope && <Members key={scope} company={scope} />}
      </section>
    </section>
  );
}
