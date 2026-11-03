import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import DecimalInput from "./DecimalInput";
import { SearchField } from "./PoolControls";
import { request } from "./commerce";
import { money, useOperation, type Row } from "./operations";
import "./additional-costs.css";
export default function PriceLists({
  company,
  onDirty,
}: {
  company: string;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useOperation(company, "catalog"),
    [data, setData] = useState<Row>({
      lists: [],
      entries: [],
      products: [],
      variants: [],
      currency: "GTQ",
    }),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<Row | null>(null),
    [kind, setKind] = useState("list"),
    [dirty, setDirty] = useState(false),
    [query, setQuery] = useState("");
  async function load() {
    const next = await request("price_list_command", {
      p_company: company,
      p_action: "list",
    });
    setData(next);
    setSelected((old) =>
      next.lists.some((l: Row) => l.id === old)
        ? old
        : next.lists.find((l: Row) => l.is_base)?.id || next.lists[0]?.id || "",
    );
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const list = data.lists.find((l: Row) => l.id === selected),
    base = data.lists.find((l: Row) => l.is_base);
  const entries = data.entries.filter(
    (e: Row) =>
      e.list_id === selected &&
      [
        data.variants.find((v: Row) => v.id === e.variant_id)?.name,
        data.variants.find((v: Row) => v.id === e.variant_id)?.sku,
        data.products.find(
          (p: Row) =>
            p.id ===
            data.variants.find((v: Row) => v.id === e.variant_id)?.product_id,
        )?.name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const update = (key: string, value: unknown) => {
    setDraft((old) => ({ ...old!, [key]: value }));
    setDirty(true);
  };
  async function close() {
    if (
      state.busy ||
      (dirty &&
        !(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))
    )
      return;
    setDraft(null);
    setDirty(false);
  }
  function editList(row?: Row) {
    setKind("list");
    setDraft(row ? { ...row } : { name: "", active: true, is_base: false });
    setDirty(false);
  }
  function editEntry(row?: Row) {
    const variant = data.variants.find((v: Row) => v.id === row?.variant_id);
    setKind("entry");
    setDraft(
      row
        ? { ...row, product_id: variant?.product_id }
        : {
            list_id: selected,
            product_id: "",
            variant_id: "",
            price: "",
            active: true,
          },
    );
    setDirty(false);
  }
  async function save() {
    if (!draft) return;
    if (
      kind === "list" &&
      draft.is_base &&
      base?.id !== draft.id &&
      base &&
      !(await confirmAction(
        `La lista «${draft.name}» reemplazará a «${base.name}» como lista de precios base. Fórmulas y nuevas ventas usarán sus precios. ¿Confirmar?`,
        { title: "Cambiar lista de precios base" },
      ))
    )
      return;
    await state.run(async () => {
      const saved = await request("price_list_command", {
        p_company: company,
        p_action: kind === "list" ? "save_list" : "save_entry",
        p_data: { ...draft, expected_base_id: base?.id || null },
      });
      if (kind === "list") setSelected(saved.id);
      setDraft(null);
      setDirty(false);
      await load();
      state.setNotice("Cambios guardados.");
    });
  }
  return (
    <section className="catalog additional-cost-settings">
      <div className="hierarchy-toolbar">
        <h2>
          <AppIcon name="action.calculate" /> Listas de precios
        </h2>
        <div className="actions">
          <AppButton
            disabled={state.busy || !!draft}
            iconKey="action.add"
            onClick={() => editList()}
          >
            Nueva lista
          </AppButton>
          <AppButton
            disabled={state.busy || !!draft}
            className="secondary"
            iconKey="action.refresh"
            onClick={() => state.run(load)}
          >
            Actualizar
          </AppButton>
        </div>
      </div>
      <p className="muted">
        La lista base determina los precios sugeridos en Ventas y los costos
        estimados en Fórmulas. Las ventas y lotes confirmados conservan sus
        importes.
      </p>
      {state.error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {!draft && (
        <>
          <div className="settings-grid">
            <label>
              Lista de precios
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Seleccionar lista</option>
                {data.lists.map((l: Row) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.is_base ? " · Base" : ""}
                    {!l.active ? " · Inactiva" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              {list && (
                <AppButton
                  className="secondary"
                  iconKey="action.edit"
                  onClick={() => editList(list)}
                >
                  Editar lista
                </AppButton>
              )}
              {list?.active && (
                <AppButton iconKey="action.add" onClick={() => editEntry()}>
                  Agregar precio
                </AppButton>
              )}
            </div>
          </div>
          <SearchField
            aria-label="Buscar precio"
            placeholder="Producto, presentación o SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Presentación / variación</th>
                  <th>Precio de venta</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e: Row) => {
                  const v = data.variants.find(
                      (v: Row) => v.id === e.variant_id,
                    ),
                    p = data.products.find((p: Row) => p.id === v?.product_id);
                  return (
                    <tr key={e.id}>
                      <td>{p?.name}</td>
                      <td>
                        {v?.name}
                        <small>{v?.sku}</small>
                      </td>
                      <td>{money(e.price, e.currency)}</td>
                      <td>{e.active ? "Activo" : "Inactivo"}</td>
                      <td className="actions">
                        {list?.active && (
                          <AppButton
                            className="secondary"
                            iconKey="action.edit"
                            onClick={() => editEntry(e)}
                          >
                            Editar
                          </AppButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!entries.length && (
                  <tr>
                    <td colSpan={5}>Sin precios en esta lista.</td>
                  </tr>
                )}
              </tbody>
            </ResponsiveTable>
          </div>
        </>
      )}
      {draft && (
        <form
          data-dirty-managed
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset disabled={state.busy} className="settings-grid">
            <legend>
              {draft.id ? "Editar" : "Crear"}{" "}
              {kind === "list" ? "lista" : "precio"}
            </legend>
            {kind === "list" ? (
              <>
                <label>
                  Nombre
                  <input
                    required
                    maxLength={120}
                    value={draft.name}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </label>
                <label>
                  Lista de precios base
                  <select
                    value={String(draft.is_base)}
                    onChange={(e) =>
                      update("is_base", e.target.value === "true")
                    }
                  >
                    <option value="false">No</option>
                    <option value="true">Sí</option>
                  </select>
                  <small>Solo una lista base por empresa.</small>
                </label>
              </>
            ) : (
              <>
                <label>
                  Producto
                  <select
                    required
                    value={draft.product_id || ""}
                    onChange={(e) => {
                      update("product_id", e.target.value);
                      update("variant_id", "");
                    }}
                  >
                    <option value="">Seleccionar producto</option>
                    {data.products
                      .filter((p: Row) => p.active || p.id === draft.product_id)
                      .map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Presentación o variación comercial
                  <select
                    required
                    value={draft.variant_id || ""}
                    onChange={(e) => update("variant_id", e.target.value)}
                  >
                    <option value="">Seleccionar presentación</option>
                    {data.variants
                      .filter(
                        (v: Row) =>
                          v.product_id === draft.product_id &&
                          (v.active || v.id === draft.variant_id) &&
                          !data.entries.some(
                            (e: Row) =>
                              e.list_id === selected &&
                              e.variant_id === v.id &&
                              e.id !== draft.id,
                          ),
                      )
                      .map((v: Row) => (
                        <option key={v.id} value={v.id}>
                          {v.sku} · {v.name}
                        </option>
                      ))}
                  </select>
                  {draft.product_id &&
                    !data.variants.some(
                      (v: Row) => v.product_id === draft.product_id,
                    ) && (
                      <small>
                        Configura una presentación en Productos antes de asignar
                        un precio.
                      </small>
                    )}
                </label>
                <label>
                  Precio de venta · {data.currency}
                  <DecimalInput
                    required
                    type="number"
                    min="0"
                    step="any"
                    value={draft.price}
                    onChange={(e) => update("price", e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Estado
              <select
                value={String(draft.active)}
                onChange={(e) => update("active", e.target.value === "true")}
              >
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </label>
            <div className="form-actions form-wide">
              <AppButton disabled={state.busy} iconKey="action.save">
                Guardar cambios
              </AppButton>
              <AppButton
                type="button"
                className="secondary"
                iconKey="action.cancel"
                onClick={close}
              >
                Cancelar
              </AppButton>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
