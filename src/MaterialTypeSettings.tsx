import { useEffect, useState } from "react";
import { supabase as db } from "./client";
import { AppButton } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import { useOperation, type Row } from "./operations";
export default function MaterialTypeSettings({
  company,
  onDirty,
}: {
  company: string;
  onDirty: (v: boolean) => void;
}) {
  const state = useOperation(company, "catalog");
  const [rows, setRows] = useState<Row[]>([]),
    [baseline, setBaseline] = useState(""),
    [loaded, setLoaded] = useState(false);
  const dirty = loaded && JSON.stringify(rows) !== baseline;
  async function load() {
    const r = await db
      .from("material_types")
      .select("*")
      .eq("company_id", company)
      .order("name");
    if (r.error) {
      state.setError(r.error.message);
      return;
    }
    setRows(r.data || []);
    setBaseline(JSON.stringify(r.data || []));
    setLoaded(true);
  }
  useEffect(() => {
    void load();
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(index: number, key: string, value: string) {
    setRows((old) =>
      old.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }
  return (
    <section className="settings-block">
      <h2>Materiales</h2>
      <h3>Tipos de materiales</h3>
      <p>
        Configura el nombre y el prefijo de los nuevos SKU. Los códigos
        existentes no se modifican. Los tipos que compartan prefijo compartirán
        la numeración.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {!loaded ? (
        <p>Cargando tipos…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void state.run(async () => {
              const r = await db.rpc("save_material_types", {
                p_company: company,
                p_entries: rows.map((t) => ({
                  id: t.id || null,
                  revision: t.revision,
                  name: t.name,
                  prefix: t.prefix,
                })),
              });
              if (r.error) throw r.error;
              setRows(r.data);
              setBaseline(JSON.stringify(r.data));
              state.setNotice("Tipos de materiales guardados.");
              window.dispatchEvent(
                new CustomEvent("ohana-material-types-saved", {
                  detail: company,
                }),
              );
            });
          }}
        >
          <fieldset
            disabled={state.busy}
            style={{ minWidth: 0, border: 0, padding: 0 }}
          >
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Tipo de material</th>
                    <th>Prefijo del SKU</th>
                    <th>Ejemplo de formato</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id || r.draftKey}>
                      <td>
                        <input
                          aria-label={`Tipo ${i + 1}`}
                          required
                          maxLength={80}
                          value={r.name}
                          onChange={(e) => edit(i, "name", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Prefijo ${i + 1}`}
                          required
                          pattern="[A-Z]{1,8}"
                          title="De 1 a 8 letras sin espacios ni acentos"
                          maxLength={8}
                          value={r.prefix}
                          onChange={(e) =>
                            edit(i, "prefix", e.target.value.toUpperCase())
                          }
                        />
                      </td>
                      <td>
                        {r.prefix || "…"}0001
                        <small>
                          Solo referencia de formato; la secuencia continúa.
                        </small>
                      </td>
                      <td>
                        {!r.id && (
                          <AppButton
                            type="button"
                            className="secondary"
                            iconKey="action.delete"
                            onClick={() =>
                              setRows((old) => old.filter((_, n) => n !== i))
                            }
                          >
                            Quitar
                          </AppButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            <div className="form-actions" style={{ marginTop: 14 }}>
              <AppButton type="submit" iconKey="action.save" disabled={!dirty}>
                Guardar cambios
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.add"
                disabled={rows.length >= 100}
                onClick={() =>
                  setRows((old) => [
                    ...old,
                    { draftKey: crypto.randomUUID(), name: "", prefix: "" },
                  ])
                }
              >
                Agregar tipo
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.cancel"
                disabled={!dirty}
                onClick={() => setRows(JSON.parse(baseline))}
              >
                Descartar cambios
              </AppButton>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
