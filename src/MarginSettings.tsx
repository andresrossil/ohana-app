import { useEffect, useState } from "react";
import { supabase as db } from "./client";
import { AppButton, AppIcon } from "./AppIcon";
import { useOperation } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import DecimalInput from "./DecimalInput";
import SearchSelect from "./SearchSelect";
import { iconRegistry } from "./icon-registry";
import {
  defaultMargins,
  marginIcons,
  validateMargins,
  type MarginRange,
} from "./margins";
export default function MarginSettings({
  company,
  onDirty,
}: {
  company: string;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useOperation(company, "catalog");
  const [ranges, setRanges] = useState<MarginRange[]>([]),
    [baseline, setBaseline] = useState(""),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState(false);
  const dirty = loaded && JSON.stringify(ranges) !== baseline;
  useEffect(() => {
    let live = true;
    void db.rpc("margin_settings", { p_company: company }).then((r) => {
      if (!live) return;
      if (r.error) {
        state.setError(r.error.message);
        return;
      }
      const rows = r.data?.ranges || defaultMargins;
      setRanges(rows);
      setBaseline(JSON.stringify(rows));
      setRevision(r.data?.revision || 0);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
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
  function edit(i: number, key: keyof MarginRange, value: any) {
    setRanges((rows) =>
      rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)),
    );
  }
  const error = validateMargins(ranges);
  return (
    <section className="settings-block margin-settings">
      <h2>Margen esperado</h2>
      <p>
        Reglas generales para todos los productos de esta empresa. El margen se
        calcula sobre el precio de venta: (precio − costo total) ÷ precio × 100.
      </p>
      <p className="muted">
        El mínimo está incluido y el máximo no. Por defecto: menos de 40 %, de
        40 % a menos de 50 %, y desde 50 %. Los importes históricos no se
        modifican.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {!loaded ? (
        <p>Cargando configuración…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (error) {
              state.setError(error);
              return;
            }
            void state.run(async () => {
              const r = await db.rpc("margin_settings", {
                p_company: company,
                p_action: "save",
                p_ranges: ranges,
                p_revision: revision,
              });
              if (r.error) throw r.error;
              setRevision(r.data.revision);
              setBaseline(JSON.stringify(ranges));
              state.setNotice("Rangos de margen guardados.");
              window.dispatchEvent(
                new CustomEvent("ohana-margins-saved", { detail: company }),
              );
            });
          }}
        >
          <fieldset disabled={state.busy}>
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Desde %</th>
                    <th>Hasta %</th>
                    <th>Color</th>
                    <th>Icono</th>
                    <th>Vista previa</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {ranges.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Nombre rango ${i + 1}`}
                          required
                          maxLength={80}
                          value={r.label}
                          onChange={(e) => edit(i, "label", e.target.value)}
                        />
                      </td>
                      <td>
                        <DecimalInput
                          aria-label={`Mínimo rango ${i + 1}`}
                          type="number"
                          step="any"
                          value={r.min ?? ""}
                          placeholder="Sin límite"
                          onChange={(e) =>
                            edit(
                              i,
                              "min",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </td>
                      <td>
                        <DecimalInput
                          aria-label={`Máximo rango ${i + 1}`}
                          type="number"
                          step="any"
                          value={r.max ?? ""}
                          placeholder="Sin límite"
                          onChange={(e) =>
                            edit(
                              i,
                              "max",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Color rango ${i + 1}`}
                          type="color"
                          value={r.color}
                          onChange={(e) => edit(i, "color", e.target.value)}
                        />
                      </td>
                      <td>
                        <SearchSelect
                          aria-label={`Icono rango ${i + 1}`}
                          value={r.icon}
                          onChange={(e) => edit(i, "icon", e.target.value)}
                        >
                          {marginIcons.map((key) => (
                            <option key={key} value={key}>
                              {iconRegistry.find((x) => x.key === key)?.label ||
                                key}
                            </option>
                          ))}
                        </SearchSelect>
                      </td>
                      <td>
                        <span
                          className="margin-badge"
                          style={{ color: r.color, borderColor: r.color }}
                        >
                          <AppIcon name={r.icon} />
                          {r.label}
                        </span>
                      </td>
                      <td>
                        <AppButton
                          type="button"
                          iconKey="action.delete"
                          className="secondary"
                          disabled={ranges.length === 1}
                          onClick={() =>
                            setRanges((rows) => rows.filter((_, n) => n !== i))
                          }
                        >
                          Quitar
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            {dirty && error && (
              <p className="muted" role="status">
                {error}
              </p>
            )}
            <div className="form-actions">
              <AppButton
                type="submit"
                iconKey="action.save"
                disabled={!dirty || state.busy}
              >
                Guardar cambios
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.add"
                disabled={ranges.length >= 20}
                onClick={() =>
                  setRanges((rows) => {
                    const last = rows.at(-1)!;
                    const split = (last.min ?? 40) + 10;
                    return [
                      ...rows.slice(0, -1),
                      { ...last, max: split },
                      {
                        label: "Nuevo rango",
                        min: split,
                        max: null,
                        color: "#285E97",
                        icon: "status.info",
                      },
                    ];
                  })
                }
              >
                Agregar rango
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.refresh"
                onClick={() => setRanges(defaultMargins.map((r) => ({ ...r })))}
              >
                Restaurar valores predeterminados
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.cancel"
                disabled={!dirty}
                onClick={() => setRanges(JSON.parse(baseline))}
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
