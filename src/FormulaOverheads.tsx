import SearchSelect from "./SearchSelect";
import { AppButton } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import DecimalInput from "./DecimalInput";
import { money, type Row } from "./operations";
import { costCatalogNames } from "./additional-costs";
export default function FormulaOverheads({
  items,
  lines,
  quote,
  onChange,
  historical = false,
}: {
  items: Row[];
  lines: Row[];
  quote: Row;
  onChange?: (lines: Row[]) => void;
  historical?: boolean;
}) {
  const legacy = [
    ...(quote.overhead_lines || []),
    ...["labor", "advertising"]
      .filter((k) => quote[k]?.id)
      .map((k) => ({ ...quote[k], cost_id: quote[k].id, kind: k })),
  ];
  const original: Row[] = onChange ? lines : quote.cost_lines || legacy;
  const kindOf = (line: Row) =>
    items.find((x) => x.id === line.cost_id)?.kind || line.kind || "overhead";
  const rank: Record<string, number> = {
    overhead: 0,
    labor: 1,
    advertising: 2,
  };
  const display = original
    .map((line, i) => ({ line, i }))
    .sort((a, b) => (rank[kindOf(a.line)] ?? 3) - (rank[kindOf(b.line)] ?? 3));
  const change = (i: number, patch: Row) =>
    onChange?.(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const amount = (v: unknown) =>
    v == null ? "Pendiente" : money(v, quote.currency);
  return (
    <section className="formula-overheads">
      <div className="form-actions">
        {onChange && (
          <AppButton
            type="button"
            className="secondary"
            iconKey="action.add"
            disabled={
              lines.length >= 100 ||
              lines.some((l) => !l.cost_id) ||
              !items.some(
                (x) => x.active && !lines.some((l) => l.cost_id === x.id),
              )
            }
            onClick={() =>
              onChange([...lines, { cost_id: "", quantity: 1, percent: null }])
            }
          >
            Agregar costo
          </AppButton>
        )}
      </div>
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Cantidad / porcentaje</th>
              <th>Base de cálculo</th>
              <th>Importe por lote</th>
              {onChange && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {display.map(({ line, i }, position) => {
              const item = items.find((x) => x.id === line.cost_id),
                row = onChange
                  ? quote.cost_lines?.find(
                      (x: Row) => x.cost_id === line.cost_id,
                    )
                  : line,
                fixed = (item?.kind || row?.kind || "overhead") === "overhead";
              return (
                <tr
                  key={line.cost_id || i}
                  className={
                    position > 0 &&
                    kindOf(display[position - 1].line) !== kindOf(line)
                      ? "expense-group-start"
                      : ""
                  }
                >
                  <td>
                    <span className="expense-kind">
                      {costCatalogNames[kindOf(line)]}
                    </span>
                    {onChange ? (
                      <SearchSelect
                        aria-label={`Costo fila ${i + 1}`}
                        required
                        value={line.cost_id}
                        onChange={(e) => {
                          const selected = items.find(
                            (x) => x.id === e.target.value,
                          );
                          change(i, {
                            cost_id: e.target.value,
                            quantity:
                              Number(
                                quote.unit_basis_count ?? quote.estimated_units,
                              ) || 1,
                            percent: null,
                          });
                        }}
                      >
                        <option value="">Seleccionar concepto</option>
                        {Object.entries(costCatalogNames).map(
                          ([kind, name]) => (
                            <optgroup key={kind} label={name}>
                              {items
                                .filter(
                                  (x) =>
                                    x.kind === kind &&
                                    (x.active || x.id === line.cost_id) &&
                                    !lines.some(
                                      (l, n) => n !== i && l.cost_id === x.id,
                                    ),
                                )
                                .map((x) => (
                                  <option
                                    key={x.id}
                                    value={x.id}
                                    disabled={!x.active}
                                  >
                                    {x.name}
                                    {!x.active ? " · Inactivo" : ""}
                                  </option>
                                ))}
                            </optgroup>
                          ),
                        )}
                      </SearchSelect>
                    ) : (
                      <>
                        {costCatalogNames[row?.kind || "overhead"]} ·{" "}
                        {row?.name}
                      </>
                    )}
                  </td>
                  <td>
                    {fixed ? (
                      <>
                        <span>{row?.quantity ?? "Unidades sin definir"}</span>
                        <small>
                          {historical
                            ? "Cantidad histórica"
                            : "Unidades del lote · automático"}
                        </small>
                      </>
                    ) : onChange ? (
                      <>
                        <DecimalInput
                          aria-label={`Valor costo ${i + 1}`}
                          type="number"
                          min={fixed ? "0.00000001" : "0"}
                          max={fixed ? undefined : "100"}
                          step="any"
                          required
                          value={
                            fixed
                              ? line.quantity
                              : (line.percent ?? item?.percent ?? "")
                          }
                          onChange={(e) =>
                            change(
                              i,
                              fixed
                                ? { quantity: e.target.value }
                                : { percent: e.target.value },
                            )
                          }
                        />
                        <small>
                          {fixed
                            ? "Unidades del lote"
                            : "% del precio base × unidades"}
                        </small>
                        {!fixed && line.percent != null && (
                          <AppButton
                            type="button"
                            className="secondary"
                            iconKey="action.refresh"
                            onClick={() => change(i, { percent: null })}
                          >
                            Usar catálogo
                          </AppButton>
                        )}
                      </>
                    ) : fixed ? (
                      row?.quantity
                    ) : (
                      `${row?.percent ?? "—"} %`
                    )}
                  </td>
                  <td>
                    {fixed
                      ? amount(row?.unit_price)
                      : quote.sale_price == null
                        ? "Pendiente de precio"
                        : amount(quote.sale_price)}
                  </td>
                  <td>
                    {!fixed && quote.sale_price == null
                      ? "Pendiente de precio"
                      : amount(row?.total)}
                  </td>
                  {onChange && (
                    <td className="actions">
                      <AppButton
                        type="button"
                        className="secondary"
                        iconKey="action.delete"
                        onClick={() =>
                          onChange(lines.filter((_, n) => n !== i))
                        }
                      >
                        Quitar
                      </AppButton>
                    </td>
                  )}
                </tr>
              );
            })}
            {!display.length && (
              <tr>
                <td colSpan={onChange ? 5 : 4}>
                  Sin costos adicionales seleccionados.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={onChange ? 4 : 3}>
                Total de costos adicionales por lote
              </th>
              <td>{amount(quote.additional_total)}</td>
            </tr>
          </tfoot>
        </ResponsiveTable>
      </div>
      {historical && (
        <small>Importes históricos conservados al confirmar el lote.</small>
      )}
    </section>
  );
}
