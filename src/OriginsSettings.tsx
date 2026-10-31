import { AppButton, AppIcon } from "./AppIcon";
import { useState } from "react";
import type { FormEvent } from "react";
import { supabase as db } from "./client";
import type { CatalogRow } from "./sheet-model";
export default function OriginsSettings({
  company,
  origins,
  canWrite,
  onSaved,
}: {
  company: string;
  origins: CatalogRow[];
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<CatalogRow | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      f = new FormData(form),
      payload = { name: String(f.get("name")).trim(), company_id: company };
    const result = edit
      ? await db
          .from("catalog_origins")
          .update(payload)
          .eq("company_id", company)
          .eq("id", edit.id)
      : await db.from("catalog_origins").insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setEdit(null);
      form.reset();
      await onSaved();
    }
    setBusy(false);
  }
  async function toggle(row: CatalogRow) {
    setBusy(true);
    setError("");
    const { error } = await db
      .from("catalog_origins")
      .update({ active: !row.active })
      .eq("company_id", company)
      .eq("id", row.id);
    if (error) setError(error.message);
    else await onSaved();
    setBusy(false);
  }
  async function remove(row: CatalogRow) {
    if (
      !window.confirm(
        `¿Eliminar el origen “${row.name}”? Solo se elimina si no está en uso.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const { error } = await db
      .from("catalog_origins")
      .delete()
      .eq("company_id", company)
      .eq("id", row.id);
    if (error)
      setError(
        error.code === "23503"
          ? "Este origen está en uso. Puedes desactivarlo y conservar sus referencias."
          : error.message,
      );
    else await onSaved();
    setBusy(false);
  }
  return (
    <section className="catalog settings-panel">
      <p className="eyebrow">ORGANIZA TU CATÁLOGO</p>
      <h2>Orígenes de materiales y productos</h2>
      <p className="muted">
        Desactivar un origen conserva los registros que ya lo utilizan.
      </p>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      {canWrite && (
        <form key={edit?.id || "new"} onSubmit={save} className="origin-form">
          <label>
            {edit ? "Editar nombre" : "Nuevo origen"}
            <input
              name="name"
              maxLength={80}
              required
              defaultValue={edit?.name || ""}
            />
          </label>
          <AppButton disabled={busy}>
            {edit ? "Guardar nombre" : "Agregar origen"}
          </AppButton>
          {edit && (
            <AppButton
              type="button"
              className="secondary"
              onClick={() => setEdit(null)}
            >
              Cancelar
            </AppButton>
          )}
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Origen</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {origins.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.active ? "Activo" : "Inactivo"}</td>
                <td className="actions">
                  {canWrite && (
                    <>
                      <AppButton disabled={busy} onClick={() => setEdit(o)}>
                        Renombrar
                      </AppButton>
                      <AppButton disabled={busy} onClick={() => void toggle(o)}>
                        {o.active ? "Desactivar" : "Reactivar"}
                      </AppButton>
                      <AppButton disabled={busy} onClick={() => void remove(o)}>
                        Eliminar
                      </AppButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
