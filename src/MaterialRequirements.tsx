import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import ResponsiveTable from "./ResponsiveTable";
import { request } from "./commerce";
import { recipeLineKinds } from "./formula-model";
import type { Row } from "./operations";
export default function MaterialRequirements({
  company,
  formula,
  scale = 1,
  units = null,
  initialOpen = false,
}: {
  company: string;
  formula?: string;
  scale?: number;
  units?: number | null;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      request("production_requirements", {
        p_company: company,
        p_formula: formula || null,
        p_scale: scale,
        p_units: units && units > 0 ? units : null,
      })
        .then((r) => {
          if (live) setRows(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [company, formula, scale, units, open, revision]);
  const num = (n: unknown) =>
    n == null
      ? "Pendiente de unidades"
      : Number(n).toLocaleString("es-GT", { maximumFractionDigits: 2 });
  return (
    <IconDetails
      open={open}
      className="formula-disclosure material-requirements"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Requerimientos de materiales y quiebres de inventario</summary>
      {open && (
        <>
          <p className="muted">
            {formula
              ? "Necesidades de esta versión para el lote previsto."
              : "Necesidades acumuladas de los lotes borrador y en preparación."}{" "}
            Incluye materias primas, empaque e insumos adicionales. Otros gastos
            no generan requerimientos. Disponible = físico − bloqueado −
            reservado. Esta consulta no reserva ni descuenta existencias.
          </p>
          <AppButton
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => setRevision((x) => x + 1)}
          >
            Actualizar requerimientos
          </AppButton>
          {error && (
            <p className="error" role="alert">
              <AppIcon name="status.error" />
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">Calculando requerimientos…</p>
          ) : (
            !error && (
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Secciones</th>
                      <th>Requerido</th>
                      <th>Disponible</th>
                      <th>Faltante / comprar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.material_id}>
                        <td>
                          {r.sku && `${r.sku} · `}
                          {r.name}
                        </td>
                        <td>
                          {r.kinds
                            .map(
                              (k: keyof typeof recipeLineKinds) =>
                                recipeLineKinds[k],
                            )
                            .join(", ")}
                        </td>
                        <td>
                          {num(r.required)} {r.unit}
                        </td>
                        <td>
                          {num(r.available)} {r.unit}
                        </td>
                        <td data-sort-value={r.shortage}>
                          {r.shortage == null ? (
                            <>
                              <AppIcon name="status.pending" />
                              {num(r.shortage)}
                            </>
                          ) : Number(r.shortage) > 0 ? (
                            <span className="material-shortage">
                              <AppIcon name="status.error" />
                              {num(r.shortage)} {r.unit}
                            </span>
                          ) : (
                            <span
                              className="material-sufficient"
                              role="img"
                              aria-label="Inventario suficiente"
                              title="Inventario suficiente"
                            >
                              <AppIcon name="status.success" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
                {!rows.length && (
                  <p className="empty">
                    No hay materiales pendientes para esta consulta.
                  </p>
                )}
              </div>
            )
          )}
        </>
      )}
    </IconDetails>
  );
}
