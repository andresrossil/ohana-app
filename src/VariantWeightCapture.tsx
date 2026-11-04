import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import ResponsiveTable from "./ResponsiveTable";
import {
  normalizedAttributes,
  weightMatches,
  type WeightVariant,
} from "./variant-weights";
import { variantLabel } from "./variant-label";
import { parseTSV } from "./sheet-model";
import { money, type Row } from "./operations";
export type WeighedUnit = {
  key: string;
  variant: string;
  weight: number;
  materialQuantities?: Record<string, string>;
};
type Draft = {
  key: string;
  group: string;
  weight: string;
  materialQuantities: Record<string, string>;
};
export default function VariantWeightCapture({
  variants,
  units,
  onReplace,
  onPending,
  busy,
  costFor,
  currency = "GTQ",
  unitMaterials = [],
}: {
  variants: WeightVariant[];
  units: WeighedUnit[];
  onReplace: (units: WeighedUnit[]) => void;
  onPending: (pending: boolean) => void;
  busy: boolean;
  costFor?: (
    variant: WeightVariant,
    weight: number,
    count: number,
    totalWeight: number,
    quantities: Record<string, string>,
  ) => Row;
  currency?: string;
  unitMaterials?: Row[];
}) {
  const groups = [
    ...new Map(
      variants
        .filter((v) => v.active !== false)
        .map((v) => [normalizedAttributes(v.attributes), v.attributes || {}]),
    ).entries(),
  ];
  const [group, setGroup] = useState(groups[0]?.[0] || ""),
    [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    units.map((u) => ({
      key: u.key,
      weight: String(u.weight),
      group: normalizedAttributes(
        variants.find((v) => v.id === u.variant)?.attributes,
      ),
      materialQuantities: u.materialQuantities || {},
    })),
  );
  useEffect(() => {
    if (!groups.some(([k]) => k === group)) setGroup(groups[0]?.[0] || "");
  }, [groups.map(([k]) => k).join("|"), group]);
  const resolve = (r: Draft) =>
    weightMatches(
      variants,
      groups.find(([k]) => k === r.group)?.[1] || {},
      r.weight,
    );
  const valid = drafts.every(
    (r) =>
      resolve(r).length === 1 &&
      Object.values(r.materialQuantities).every(
        (q) => q === "" || (Number.isFinite(Number(q)) && Number(q) >= 0),
      ),
  );
  useEffect(() => {
    onPending(!valid);
    return () => onPending(false);
  }, [valid, onPending]);
  const totalWeight = drafts.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  function update(next: Draft[]) {
    setDrafts(next);
    setError("");
    const allValid = next.every(
      (r) =>
        resolve(r).length === 1 &&
        Object.values(r.materialQuantities).every(
          (q) => q === "" || (Number.isFinite(Number(q)) && Number(q) >= 0),
        ),
    );
    if (allValid)
      onReplace(
        next.map((r) => ({
          key: r.key,
          variant: resolve(r)[0].id,
          weight: Number(r.weight),
          materialQuantities: r.materialQuantities,
        })),
      );
  }
  function paste(text: string, start = drafts.length) {
    try {
      const values = parseTSV(text).filter((r) => r.some((v) => v.trim()));
      if (values[0]?.length === 1 && /peso/i.test(values[0][0])) values.shift();
      if (values.some((r) => r.length !== 1))
        throw Error(
          "Pega una sola columna de pesos en gramos. Selecciona los atributos antes de pegar.",
        );
      if (start + values.length > 10000)
        throw Error("Máximo 10,000 unidades por lote.");
      const next = drafts.map((r) => ({ ...r }));
      values.forEach(([v], i) => {
        while (next.length <= start + i)
          next.push({
            key: crypto.randomUUID(),
            group,
            weight: "",
            materialQuantities: {},
          });
        next[start + i] = {
          ...next[start + i],
          weight: v.trim().replace(",", "."),
        };
      });
      update(next);
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <IconDetails className="formula-disclosure" open>
      <summary>
        <AppIcon name="action.calculate" /> Unidades por peso · {drafts.length}
      </summary>
      <div className="additional-costs-content">
        <label>
          Atributos para nuevas filas
          <select
            disabled={busy}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            {groups.map(([k, a]) => (
              <option key={k} value={k}>
                {Object.entries(a)
                  .map(([key, v]) => key + ": " + v)
                  .join(" · ") || "Sin atributos"}
              </option>
            ))}
          </select>
        </label>
        <label className="weight-paste-panel">
          Pegar pesos desde Excel
          <textarea
            rows={2}
            value=""
            disabled={busy}
            placeholder="Pega una columna de pesos. Las filas se crean automáticamente."
            onChange={(e) => {
              if (e.target.value) paste(e.target.value);
            }}
            onPaste={(e) => {
              e.preventDefault();
              paste(e.clipboardData.getData("text/plain"));
            }}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <AppButton
            type="button"
            disabled={busy || drafts.length >= 10000}
            onClick={() =>
              update([
                ...drafts,
                {
                  key: crypto.randomUUID(),
                  group,
                  weight: "",
                  materialQuantities: {},
                },
              ])
            }
          >
            Agregar fila
          </AppButton>
        </div>
        <p className="muted">
          {drafts.length} unidades · Peso total:{" "}
          {totalWeight.toLocaleString("es-GT", { maximumFractionDigits: 4 })} g.
          Corrige cualquier peso antes de confirmar.
        </p>
        {unitMaterials.length > 0 && (
          <p className="muted">
            Empaque e insumos por unidad: por defecto se reparte el consumo real
            entre las unidades. Puedes corregir cada consumo; su suma debe
            coincidir con el total registrado arriba.
          </p>
        )}
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>#</th>
                <th>Peso real (g)</th>
                <th>Atributos</th>
                <th>Variante asignada</th>
                {unitMaterials.map((m) => (
                  <th key={m.id}>
                    {m.name} ({m.unit})
                  </th>
                ))}
                <th>Costo estimado</th>
                <th>Margen aprox.</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((r, i) => {
                const matches = resolve(r),
                  v = matches.length === 1 ? matches[0] : null;
                const cost =
                  v && costFor
                    ? costFor(
                        v,
                        Number(r.weight),
                        drafts.length,
                        totalWeight,
                        r.materialQuantities,
                      )
                    : null;
                return (
                  <tr key={r.key}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        aria-label={"Peso de unidad " + (i + 1)}
                        inputMode="decimal"
                        value={r.weight}
                        disabled={busy}
                        onChange={(e) =>
                          update(
                            drafts.map((x, n) =>
                              n === i
                                ? {
                                    ...x,
                                    weight: e.target.value.replace(",", "."),
                                  }
                                : x,
                            ),
                          )
                        }
                        onPaste={(e) => {
                          const t = e.clipboardData.getData("text/plain");
                          if (/[\t\n\r]/.test(t)) {
                            e.preventDefault();
                            paste(t, i);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={"Atributos de unidad " + (i + 1)}
                        value={r.group}
                        disabled={busy}
                        onChange={(e) =>
                          update(
                            drafts.map((x, n) =>
                              n === i ? { ...x, group: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        {groups.map(([k, a]) => (
                          <option key={k} value={k}>
                            {Object.values(a).join(" · ") || "Sin atributos"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {v ? (
                        variantLabel(v)
                      ) : (
                        <span className="sheet-warning">
                          {matches.length > 1
                            ? "Ambigüedad: revisa variantes"
                            : "Peso o rango no válido"}
                        </span>
                      )}
                    </td>
                    {unitMaterials.map((m) => (
                      <td key={m.id}>
                        <input
                          aria-label={m.name + " de unidad " + (i + 1)}
                          inputMode="decimal"
                          disabled={busy}
                          value={r.materialQuantities[m.id] ?? ""}
                          placeholder={String(
                            Number(m.quantity) / Math.max(drafts.length, 1),
                          )}
                          onChange={(e) =>
                            update(
                              drafts.map((x, n) =>
                                n === i
                                  ? {
                                      ...x,
                                      materialQuantities: {
                                        ...x.materialQuantities,
                                        [m.id]: e.target.value.replace(
                                          ",",
                                          ".",
                                        ),
                                      },
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>
                      {cost ? money(cost.total_cost, currency) : "Pendiente"}
                      {cost && (
                        <small>
                          Fabricación:{" "}
                          {money(cost.manufacturing_cost, currency)} ·
                          Comerciales: {money(cost.commercial_cost, currency)}
                        </small>
                      )}
                    </td>
                    <td>
                      {cost ? money(cost.margin, currency) : "Pendiente"}
                      {cost?.margin != null && (
                        <>
                          <small>
                            Margen / venta:{" "}
                            {Number(cost.sale_price) > 0
                              ? (
                                  (cost.margin / Number(cost.sale_price)) *
                                  100
                                ).toFixed(2) + " %"
                              : "Pendiente"}
                          </small>
                          <small>
                            Recargo / costo:{" "}
                            {cost.total_cost > 0
                              ? ((cost.margin / cost.total_cost) * 100).toFixed(
                                  2,
                                ) + " %"
                              : "Pendiente"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <AppButton
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => update(drafts.filter((_, n) => n !== i))}
                      >
                        Quitar unidad
                      </AppButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
        {!valid && (
          <p role="alert" className="sheet-warning">
            Corrige las filas pendientes antes de confirmar. No se asignarán
            variantes incorrectas.
          </p>
        )}
      </div>
    </IconDetails>
  );
}
