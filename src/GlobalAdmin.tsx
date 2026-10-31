import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState } from "react";
import { request } from "./commerce";
import type { Row } from "./operations";
export default function GlobalAdmin() {
  const [allowed, setAllowed] = useState(false),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [self, setSelf] = useState("");
  async function load() {
    setData(await request("platform_admin", { p_action: "list" }));
  }
  useEffect(() => {
    let live = true;
    request("platform_access", {})
      .then(async (access) => {
        if (!live || !access) return;
        setAllowed(true);
        await load();
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function save(action: string, payload: Row) {
    setBusy(true);
    setError("");
    try {
      await request("platform_admin", { p_action: action, p_data: payload });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) return null;
  return (
    <section className="settings-block">
      <h2>Administración de plataforma</h2>
      <p>
        Este acceso administra cuentas y catálogos globales. No concede acceso a
        la información comercial de las empresas.
      </p>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      {data && (
        <>
          <details>
            <summary>Cuentas y rol reservado</summary>
            <p>
              La asignación requiere una cuenta verificada. No puedes cambiar tu
              propio rol global.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("role", {
                  user: f.get("user"),
                  enabled: f.get("enabled") === "true",
                });
              }}
            >
              <label>
                Cuenta
                <select
                  name="user"
                  required
                  value={self}
                  onChange={(e) => setSelf(e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {data.users.map((u: Row) => (
                    <option key={u.id} value={u.id}>
                      {u.email} · {u.verified ? "Verificada" : "Sin verificar"}
                      {u.platform_admin ? " · Superadministrador" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Acceso global
                <select name="enabled">
                  <option value="true">Asignar superadministrador</option>
                  <option value="false">Retirar superadministrador</option>
                </select>
              </label>
              <label>
                <input type="checkbox" required /> Confirmo esta asignación
                administrativa explícita
              </label>
              <AppButton disabled={busy}>Guardar rol global</AppButton>
            </form>
          </details>
          {[
            ["country", "Países", "countries"],
            ["currency", "Monedas", "currencies"],
          ].map(([action, title, key]) => (
            <details key={action}>
              <summary>{title}</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data[key].map((r: Row) => (
                      <tr key={r.code}>
                        <td>{r.code}</td>
                        <td>{r.name}</td>
                        <td>{r.active ? "Activo" : "Inactivo"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save(action, {
                    code: f.get("code"),
                    name: f.get("name"),
                    active: f.get("active") === "true",
                  });
                }}
              >
                <label>
                  Código ISO
                  <input
                    name="code"
                    required
                    pattern={
                      action === "country" ? "[A-Za-z]{2}" : "[A-Za-z]{3}"
                    }
                    maxLength={action === "country" ? 2 : 3}
                  />
                </label>
                <label>
                  Nombre
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Estado
                  <select name="active">
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </label>
                <AppButton disabled={busy}>Guardar código</AppButton>
              </form>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
