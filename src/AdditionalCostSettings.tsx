import { pricesChanged } from "./price-events";
import MoneyInput from "./MoneyInput";
import SearchSelect from "./SearchSelect";
import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import { request } from "./commerce";
import { money, useOperation, type Row } from "./operations";
import { costCatalogNames } from "./additional-costs";
import "./additional-costs.css";
export default function AdditionalCostSettings({
  company,
  kind,
  onDirty,
}: {
  company: string;
  kind: string;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useOperation(company, "production"),
    [data, setData] = useState<Row>({
      items: [],
      can_manage: false,
      currency: "GTQ",
    }),
    [draft, setDraft] = useState<Row | null>(null),
    [dirty, setDirty] = useState(false);
  async function load() {
    setData(
      await request("additional_cost_command", {
        p_company: company,
        p_action: "list",
      }),
    );
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const items: Row[] = data.items.filter((x: Row) => x.kind === kind),
    expense = kind === "overhead";
  const totals = new Map<string, number>();
  items
    .filter((x) => x.active)
    .forEach((x) =>
      totals.set(
        x.currency,
        (totals.get(x.currency) || 0) +
          Number(x.quantity) * Number(x.unit_price),
      ),
    );
  const update = (key: string, value: unknown) => {
    setDraft((old) => ({ ...old!, [key]: value }));
    setDirty(true);
  };
  async function close() {
    if (
      state.busy ||
      (dirty &&
        !(await confirmAction("Hay cambios sin guardar. ¿Descartarlos?")))
    )
      return;
    setDraft(null);
    setDirty(false);
  }
  return (
    <section className="catalog additional-cost-settings">
      <div className="hierarchy-toolbar">
        <h2>
          <AppIcon name="action.calculate" /> {costCatalogNames[kind]}
        </h2>
        {data.can_manage && !draft && (
          <AppButton
            disabled={state.busy}
            onClick={() => {
              setDraft({
                kind,
                name: "",
                quantity: 1,
                unit_price: 0,
                percent: 0,
                currency: data.currency,
                active: true,
              });
              setDirty(false);
            }}
          >
            Agregar concepto
          </AppButton>
        )}
      </div>
      <p className="muted">
        {expense
          ? "Los conceptos de este catálogo se seleccionan en cada fórmula. Solo los gastos elegidos se aplican una vez por lote."
          : "Selecciona un nivel en la fórmula. El porcentaje se calcula sobre el precio de venta de su presentación."}
      </p>
      {state.error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {draft && (
        <form
          data-dirty-managed
          onSubmit={(e) => {
            e.preventDefault();
            state.run(async () => {
              await request("additional_cost_command", {
                p_company: company,
                p_action: "save",
                p_data: draft,
              });
              setDraft(null);
              setDirty(false);
              state.setNotice("Cambios guardados.");
              await load();
              pricesChanged(company);
            });
          }}
        >
          <fieldset disabled={state.busy} className="settings-grid">
            <legend>
              {draft.id ? "Editar" : "Nuevo"} {expense ? "concepto" : "nivel"}
            </legend>
            <label>
              Nombre
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            {expense ? (
              <>
                <label>
                  Cantidad
                  <input
                    required
                    type="number"
                    min="0"
                    max="999999999999"
                    step="any"
                    value={draft.quantity}
                    onChange={(e) => update("quantity", e.target.value)}
                  />
                </label>
                <label>
                  Precio unitario ({draft.currency})
                  <MoneyInput
                    currency={draft.currency}
                    required
                    type="number"
                    min="0"
                    max="999999999999"
                    step="any"
                    value={draft.unit_price}
                    onChange={(e) => update("unit_price", e.target.value)}
                  />
                </label>
                <label>
                  Moneda
                  <SearchSelect
                    value={draft.currency}
                    onChange={(e) => update("currency", e.target.value)}
                  >
                    {Array.from(
                      new Set(["GTQ", data.currency, draft.currency]),
                    ).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </SearchSelect>
                </label>
              </>
            ) : (
              <label>
                Porcentaje sobre precio de venta
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={draft.percent}
                  onChange={(e) => update("percent", e.target.value)}
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => update("active", e.target.checked)}
              />
              Activo
            </label>
            <div className="form-actions">
              <AppButton disabled={state.busy}>Guardar cambios</AppButton>
              <AppButton type="button" className="secondary" onClick={close}>
                Cancelar
              </AppButton>
            </div>
          </fieldset>
        </form>
      )}
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              <th>Nombre</th>
              {expense ? (
                <>
                  <th>Cantidad</th>
                  <th>Precio unitario</th>
                  <th>Total</th>
                </>
              ) : (
                <th>Porcentaje</th>
              )}
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                {expense ? (
                  <>
                    <td>
                      {Number(x.quantity).toLocaleString("es-GT", {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>{money(x.unit_price, x.currency)}</td>
                    <td>
                      {money(
                        Number(x.quantity) * Number(x.unit_price),
                        x.currency,
                      )}
                    </td>
                  </>
                ) : (
                  <td>
                    {Number(x.percent).toLocaleString("es-GT", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    %
                  </td>
                )}
                <td>
                  <AppIcon
                    name={x.active ? "status.active" : "status.archived"}
                  />
                  {x.active ? "Activo" : "Inactivo"}
                </td>
                <td className="actions">
                  {data.can_manage && (
                    <>
                      <AppButton
                        disabled={state.busy || !!draft}
                        onClick={() => {
                          setDraft({ ...x });
                          setDirty(false);
                        }}
                      >
                        Editar
                      </AppButton>
                      <AppButton
                        disabled={state.busy || !!draft}
                        onClick={() =>
                          state.run(async () => {
                            await request("additional_cost_command", {
                              p_company: company,
                              p_action: "save",
                              p_data: { ...x, active: !x.active },
                            });
                            await load();
                            pricesChanged(company);
                          })
                        }
                      >
                        {x.active ? "Desactivar" : "Activar"}
                      </AppButton>
                      {!x.associated && (
                        <AppButton
                          disabled={state.busy || !!draft}
                          onClick={async () => {
                            if (await confirmAction(`¿Eliminar ${x.name}?`))
                              state.run(async () => {
                                await request("additional_cost_command", {
                                  p_company: company,
                                  p_action: "delete",
                                  p_data: { id: x.id, revision: x.revision },
                                });
                                state.setNotice("Registro eliminado.");
                                await load();
                                pricesChanged(company);
                              });
                          }}
                        >
                          Eliminar
                        </AppButton>
                      )}
                    </>
                  )}
                  {x.associated && (
                    <small>Con asociaciones · se puede desactivar</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      {!items.length && <p className="empty">No hay conceptos registrados.</p>}
      {expense && (
        <p>
          <strong>
            Total de referencia del catálogo:{" "}
            {totals.size
              ? [...totals].map(([c, n]) => money(n, c)).join(" + ")
              : money(0, data.currency)}
          </strong>
        </p>
      )}
    </section>
  );
}
