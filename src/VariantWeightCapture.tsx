import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import {
  normalizedAttributes,
  weightMatches,
  weightRangeLabel,
  type WeightVariant,
} from "./variant-weights";
export type WeighedUnit = { key: string; variant: string; weight: number };
export default function VariantWeightCapture({
  variants,
  units,
  onAdd,
  onRemove,
  onPending,
  busy,
}: {
  variants: WeightVariant[];
  units: WeighedUnit[];
  onAdd: (variant: WeightVariant, weight: number) => boolean;
  onRemove: (key: string) => void;
  onPending: (pending: boolean) => void;
  busy: boolean;
}) {
  const groups = [
    ...new Map(
      variants
        .filter((v) => v.active !== false)
        .map((v) => [normalizedAttributes(v.attributes), v.attributes || {}]),
    ).entries(),
  ];
  const [group, setGroup] = useState(""),
    [weight, setWeight] = useState("");
  useEffect(() => {
    onPending(weight !== "");
  }, [weight, onPending]);
  useEffect(() => {
    if (!groups.some(([key]) => key === group)) setGroup(groups[0]?.[0] || "");
  }, [groups.map(([key]) => key).join("|"), group]);
  const attributes = groups.find(([key]) => key === group)?.[1] || {};
  const matches = weightMatches(variants, attributes, weight),
    match = matches.length === 1 ? matches[0] : null;
  const add = () => {
    if (match && !busy && onAdd(match, Number(weight))) setWeight("");
  };
  const name = (v: WeightVariant) => variantLabel(v);
  return (
    <IconDetails className="formula-disclosure" open>
      <summary>
        <AppIcon name="action.calculate" /> Registrar por peso unitario
      </summary>
      <div className="additional-costs-content">
        <p className="muted">
          Cada peso identifica una variante del producto y atributos
          seleccionados. Se acumulan la cantidad y el peso total
          automáticamente.
        </p>
        <div className="settings-grid">
          <label>
            Atributos
            <select
              value={group}
              disabled={busy}
              onChange={(e) => {
                setGroup(e.target.value);
                setWeight("");
              }}
            >
              {groups.map(([key, a]) => (
                <option key={key} value={key}>
                  {Object.keys(a).length
                    ? Object.entries(a)
                        .map(([k, v]) => k + ": " + v)
                        .join(" · ")
                    : "Sin atributos"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Peso real de una unidad (g)
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={weight}
              disabled={busy}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </label>
        </div>
        {weight !== "" && (
          <p role="status" className={match ? "muted" : "sheet-warning"}>
            {match
              ? name(match)
              : matches.length > 1
                ? "Hay ambigüedad entre variantes. Revisa los rangos; no se asignó la unidad."
                : "Sin rango válido para este peso y atributos. Revisa la configuración; no se asignó la unidad."}
          </p>
        )}
        <div className="form-actions">
          <AppButton
            type="button"
            iconKey="action.add"
            disabled={!match || busy || units.length >= 10000}
            onClick={add}
          >
            Registrar unidad
          </AppButton>
        </div>
        {units.length > 0 && (
          <IconDetails>
            <summary>Unidades pesadas · {units.length}</summary>
            <ul>
              {units.map((unit) => (
                <li key={unit.key} className="actions">
                  <span>
                    {variants.find((v) => v.id === unit.variant)?.name} ·{" "}
                    {unit.weight.toLocaleString("es-GT", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    g
                  </span>
                  <AppButton
                    type="button"
                    className="secondary"
                    iconKey="action.delete"
                    disabled={busy}
                    onClick={() => onRemove(unit.key)}
                  >
                    Quitar unidad
                  </AppButton>
                </li>
              ))}
            </ul>
          </IconDetails>
        )}
      </div>
    </IconDetails>
  );
}
import { variantLabel } from "./variant-label";
