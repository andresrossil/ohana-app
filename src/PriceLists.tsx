import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import DecimalInput from "./DecimalInput";
import { SearchField } from "./PoolControls";
import { request } from "./commerce";
import { money, useOperation, type Row } from "./operations";
import { parseNumber } from "./sheet-model";
import { weightRangeLabel } from "./variant-weights";
import { pricesChanged } from "./price-events";
import VariantManager from "./VariantManager";
import "./additional-costs.css";
import { priceCost } from "./price-cost";
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
    [changes, setChanges] = useState<Record<string, Row>>({}),
    [query, setQuery] = useState(""),
    [variantProduct, setVariantProduct] = useState<Row | null>(null);
  const [costs, setCosts] = useState<Row>({
    company: "",
    catalog: null,
    formulas: [],
    error: "",
  });
  const batch = useRef<{ payload: string; id: string } | null>(null),
    dirty = !!draft || !!variantProduct || Object.keys(changes).length > 0;
  const loadGeneration = useRef(0);
  async function load() {
    const ticket = ++loadGeneration.current;
    const [next, catalogResult, formulasResult] = await Promise.all([
      request("price_list_command", {
        p_company: company,
        p_action: "list",
      }),
      request("formula_catalog", { p_company: company }).then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      ),
      request("formula_command", { p_company: company, p_action: "list" }).then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      ),
    ]);
    if (ticket !== loadGeneration.current) return;
    const costError = catalogResult.error || formulasResult.error;
    setCosts({
      company,
      catalog: catalogResult.value,
      formulas: formulasResult.value || [],
      error: costError
        ? costError.code === "42501"
          ? "Sin permiso para consultar costos"
          : "No se pudieron cargar los costos"
        : "",
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
    return () => {
      loadGeneration.current++;
    };
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const list = data.lists.find((l: Row) => l.id === selected),
    base = data.lists.find((l: Row) => l.is_base);
  const allRows: Row[] = data.products
    .flatMap((p: Row) => {
      const variants = data.variants
        .filter((v: Row) => v.product_id === p.id)
        .sort(
          (a: Row, b: Row) =>
            Number(a.weight_min ?? Infinity) -
              Number(b.weight_min ?? Infinity) || a.name.localeCompare(b.name),
        );
      return variants.length
        ? variants.map((v: Row) => {
            const e = data.entries.find(
              (e: Row) => e.list_id === selected && e.variant_id === v.id,
            );
            return {
              product: p,
              variant: v,
              entry: e,
              ...(changes[v.id] || {}),
            };
          })
        : [{ product: p, variant: null }];
    })
    .sort(
      (a: Row, b: Row) =>
        a.product.name.localeCompare(b.product.name) ||
        Number(a.variant?.weight_min ?? Infinity) -
          Number(b.variant?.weight_min ?? Infinity),
    );
  const rows = allRows.filter((r) =>
    [
      r.product.name,
      r.product.sku,
      r.variant?.name,
      r.variant?.commercial_code,
      r.variant?.sku,
      r.variant ? weightRangeLabel(r.variant) : "",
      ...Object.entries(r.variant?.attributes || {}).flat(),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function current(r: Row): Row {
    return (
      changes[r.variant.id] || {
        id: r.entry?.id || "",
        revision: r.entry?.revision || 0,
        variant_id: r.variant.id,
        price: r.entry?.price ?? "",
        active: r.entry?.active ?? false,
      }
    );
  }
  function edit(r: Row, patch: Row) {
    setChanges((old) => ({
      ...old,
      [r.variant.id]: { ...current(r), ...patch },
    }));
    state.setError("");
  }
  async function discard() {
    if (
      dirty &&
      !(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?"))
    )
      return false;
    setDraft(null);
    setChanges({});
    batch.current = null;
    return true;
  }
  async function select(id: string) {
    if (id === selected) return;
    if (await discard()) setSelected(id);
  }
  async function editList(row?: Row) {
    if (!(await discard())) return;
    setDraft(row ? { ...row } : { name: "", active: true, is_base: false });
  }
  async function saveList() {
    if (!draft) return;
    if (
      draft.is_base &&
      base &&
      base.id !== draft.id &&
      !(await confirmAction(
        "La lista «" +
          draft.name +
          "» reemplazará a «" +
          base.name +
          "» como lista base. ¿Confirmar?",
        { title: "Cambiar lista base" },
      ))
    )
      return;
    await state.run(async () => {
      const saved = await request("price_list_command", {
        p_company: company,
        p_action: "save_list",
        p_data: { ...draft, expected_base_id: base?.id || null },
      });
      setDraft(null);
      setSelected(saved.id);
      await load();
      pricesChanged(company);
      state.setNotice("Lista guardada.");
    });
  }
  async function deleteList() {
    if (!list || !(await discard())) return;
    if (
      !(await confirmAction(
        "¿Eliminar la lista «" +
          list.name +
          "» y sus precios sin historial? Si tiene referencias históricas, se conservará.",
        { title: "Eliminar lista" },
      ))
    )
      return;
    await state.run(async () => {
      await request("price_list_command", {
        p_company: company,
        p_action: "delete_list",
        p_data: { id: list.id, revision: list.revision },
      });
      await load();
      pricesChanged(company);
      state.setNotice("Lista eliminada.");
    });
  }
  async function deleteEntry(r: Row) {
    const value = current(r);
    if (value.delete) {
      edit(r, { delete: false });
      return;
    }
    if (!value.id) {
      setChanges((old) => {
        const next = { ...old };
        delete next[r.variant.id];
        return next;
      });
      return;
    }
    if (
      await confirmAction(
        "¿Eliminar el precio de " +
          r.variant.name +
          " de esta lista al guardar los cambios? Si tiene historial, deberás desactivarlo.",
        { title: "Eliminar precio" },
      )
    )
      edit(r, { delete: true });
  }
  async function saveGrid() {
    const values = Object.values(changes).filter((v) => v.id || v.price !== "");
    if (!values.length) {
      setChanges({});
      return;
    }
    if (values.length > 500) {
      state.setError("Guarda como máximo 500 cambios a la vez.");
      return;
    }
    if (
      values.some(
        (v) =>
          !v.delete &&
          (parseNumber(String(v.price)) === null ||
            parseNumber(String(v.price))! < 0),
      )
    ) {
      state.setError("Indica precios válidos, mayores o iguales a cero.");
      return;
    }
    await state.run(async () => {
      const payload = {
        list_id: selected,
        rows: values.map((v) => ({
          ...v,
          price: v.delete ? undefined : parseNumber(String(v.price)),
        })),
      };
      const encoded = JSON.stringify(payload);
      if (!batch.current || batch.current.payload !== encoded)
        batch.current = { payload: encoded, id: crypto.randomUUID() };
      await request("price_list_command", {
        p_company: company,
        p_action: "save_grid",
        p_data: { ...payload, batch_id: batch.current.id },
      });
      setChanges({});
      batch.current = null;
      await load();
      pricesChanged(company);
      state.setNotice(values.length + " precio(s) guardados.");
    });
  }
  function paste(e: React.ClipboardEvent<HTMLInputElement>, r: Row) {
    const text = e.clipboardData
      .getData("text/plain")
      .replace(/\r/g, "")
      .trimEnd();
    if (!text.includes("\n")) return;
    e.preventDefault();
    const lines = text.split("\n");
    if (lines.some((s) => s.includes("\t"))) {
      state.setError(
        "Copia solamente la columna de precios para pegarlos en orden.",
      );
      return;
    }
    const targets = rows.filter((x) => x.variant),
      start = targets.findIndex((x) => x.variant.id === r.variant.id);
    if (
      start + lines.length > targets.length ||
      lines.some((s) => parseNumber(s) === null || parseNumber(s)! < 0)
    ) {
      state.setError(
        "El pegado contiene precios inválidos o supera las variantes visibles.",
      );
      return;
    }
    const edits: Record<string, Row> = {};
    lines.forEach((s, i) => {
      const row = targets[start + i];
      edits[row.variant.id] = {
        ...current(row),
        price: parseNumber(s),
        active: true,
        delete: false,
      };
    });
    setChanges((old) => ({ ...old, ...edits }));
    state.setNotice(
      lines.length + " precios pegados. Revisa y guarda los cambios.",
    );
  }
  return (
    <section className="catalog additional-cost-settings price-lists">
      <div className="hierarchy-toolbar">
        <h2>
          <AppIcon name="action.calculate" /> Listas de precios
        </h2>
        <div className="actions">
          <AppButton
            iconKey="action.add"
            disabled={state.busy}
            onClick={() => editList()}
          >
            Nueva lista
          </AppButton>
          <AppButton
            iconKey="action.refresh"
            className="secondary"
            disabled={state.busy}
            onClick={async () => {
              if (await discard()) state.run(load);
            }}
          >
            Actualizar
          </AppButton>
        </div>
      </div>
      <p className="muted">
        Precios de productos y variantes comerciales. La lista base se utiliza
        en Fórmulas, Productos y Ventas. Los históricos conservan los importes
        aplicados.
      </p>
      {state.error && (
        <p role="alert" className="error">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {draft ? (
        <form
          data-dirty-managed
          onSubmit={(e) => {
            e.preventDefault();
            saveList();
          }}
        >
          <fieldset className="settings-grid" disabled={state.busy}>
            <legend>{draft.id ? "Editar lista" : "Nueva lista"}</legend>
            <label>
              Nombre
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Lista base
              <select
                value={String(draft.is_base)}
                onChange={(e) =>
                  setDraft({ ...draft, is_base: e.target.value === "true" })
                }
              >
                <option value="false">No</option>
                <option value="true">Sí</option>
              </select>
            </label>
            <label>
              Estado
              <select
                value={String(draft.active)}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.value === "true" })
                }
              >
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </label>
            <div className="form-actions form-wide">
              <AppButton iconKey="action.save">Guardar cambios</AppButton>
              <AppButton
                className="secondary"
                type="button"
                iconKey="action.cancel"
                onClick={discard}
              >
                Cancelar
              </AppButton>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <div className="settings-grid">
            <label>
              Lista de precios
              <select
                value={selected}
                disabled={state.busy}
                onChange={(e) => select(e.target.value)}
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
                <>
                  <AppButton
                    className="secondary"
                    iconKey="action.edit"
                    onClick={() => editList(list)}
                  >
                    Editar lista
                  </AppButton>
                  <AppButton
                    className="secondary"
                    iconKey="action.delete"
                    disabled={state.busy || list.is_base}
                    onClick={deleteList}
                  >
                    Eliminar lista
                  </AppButton>
                </>
              )}
            </div>
          </div>
          <div className="form-actions">
            <SearchField
              aria-label="Buscar precio"
              placeholder="Producto, SKU, variante, peso o atributos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <AppButton
              iconKey="action.save"
              disabled={
                state.busy || !list?.active || !Object.keys(changes).length
              }
              onClick={saveGrid}
            >
              Guardar cambios
            </AppButton>
            {Object.keys(changes).length > 0 && (
              <AppButton
                className="secondary"
                iconKey="action.cancel"
                disabled={state.busy}
                onClick={discard}
              >
                Descartar cambios
              </AppButton>
            )}
          </div>
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th>Variante</th>
                  <th>Peso</th>
                  <th>Atributos</th>
                  <th>
                    Precio {data.currency === "GTQ" ? "Q" : data.currency}
                  </th>
                  <th>Costo total estimado / unidad</th>
                  <th>
                    Diferencia aprox.<small>Precio − costo</small>
                  </th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = r.variant,
                    value = v ? current(r) : null;
                  const reference =
                    v &&
                    costs.catalog?.presentations?.find(
                      (p: Row) => p.id === v.id,
                    );
                  const previewReference =
                    list?.is_base && value
                      ? {
                          ...reference,
                          id: v?.id,
                          currency: data.currency,
                          price:
                            value.active && !value.delete
                              ? parseNumber(String(value.price))
                              : null,
                        }
                      : reference;
                  const estimate =
                    v &&
                    costs.company === company &&
                    costs.catalog &&
                    !costs.error
                      ? priceCost(
                          v,
                          costs.formulas,
                          costs.catalog,
                          previewReference,
                        )
                      : {
                          cost: null,
                          reason:
                            (costs.company === company && costs.error) ||
                            "Pendiente",
                          source: "",
                        };
                  const price =
                    value && !value.delete && value.active
                      ? parseNumber(String(value.price))
                      : null;
                  const margin =
                    estimate.cost != null && price != null
                      ? price - estimate.cost
                      : null;
                  return (
                    <tr
                      key={v?.id || r.product.id}
                      className={value?.delete ? "price-pending-delete" : ""}
                    >
                      <td className="admin-name">{r.product.name}</td>
                      <td>{v?.sku || r.product.sku || "—"}</td>
                      <td className="admin-name">
                        {v ? variantLabel(v) : "Sin variantes comerciales"}
                      </td>
                      <td>{v ? weightRangeLabel(v) : "—"}</td>
                      <td>
                        {Object.entries(v?.attributes || {})
                          .map(([k, v]) => k + ": " + v)
                          .join(" · ") || "—"}
                      </td>
                      <td>
                        {v ? (
                          <DecimalInput
                            aria-label={"Precio de " + v.name}
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Pendiente"
                            disabled={
                              state.busy || !list?.active || value!.delete
                            }
                            value={value!.price}
                            onPaste={(e) => paste(e, r)}
                            onChange={(e) =>
                              edit(r, {
                                price: e.target.value,
                                active: !value!.id ? true : value!.active,
                              })
                            }
                          />
                        ) : (
                          <span>Pendiente</span>
                        )}
                      </td>
                      <td className="price-estimate">
                        {estimate.cost == null
                          ? "Pendiente"
                          : money(estimate.cost, data.currency)}
                        <small>{estimate.reason || estimate.source}</small>
                      </td>
                      <td
                        className={
                          margin == null
                            ? "price-estimate"
                            : margin < 0
                              ? "price-estimate margin-negative"
                              : margin > 0
                                ? "price-estimate margin-positive"
                                : "price-estimate"
                        }
                      >
                        {margin == null
                          ? "Pendiente"
                          : money(margin, data.currency)}
                      </td>
                      <td>
                        {v ? (
                          <select
                            aria-label={"Estado del precio de " + v.name}
                            disabled={
                              state.busy ||
                              !list?.active ||
                              value!.delete ||
                              (!value!.id && value!.price === "")
                            }
                            value={value!.active ? "active" : "inactive"}
                            onChange={(e) =>
                              edit(r, { active: e.target.value === "active" })
                            }
                          >
                            {!value!.id && value!.price === "" ? (
                              <option value="inactive">Pendiente</option>
                            ) : (
                              <>
                                <option value="active">Activo</option>
                                <option value="inactive">Inactivo</option>
                              </>
                            )}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="actions">
                        {!v && r.product.active && (
                          <AppButton
                            type="button"
                            className="secondary"
                            iconKey="action.add"
                            disabled={state.busy}
                            onClick={() => setVariantProduct(r.product)}
                          >
                            Crear variante
                          </AppButton>
                        )}
                        {v && (value!.id || changes[v.id]) && (
                          <AppButton
                            type="button"
                            className="secondary"
                            iconKey={
                              value!.delete ? "action.back" : "action.delete"
                            }
                            disabled={state.busy || !list?.active}
                            onClick={() => deleteEntry(r)}
                          >
                            {value!.delete ? "Conservar" : "Eliminar"}
                          </AppButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={8}>No hay productos para esta búsqueda.</td>
                  </tr>
                )}
              </tbody>
            </ResponsiveTable>
          </div>
          <small>
            Costo por unidad de la fórmula vinculada: materias primas, empaque,
            insumos y costos adicionales. Mano de obra y publicidad usan el
            precio de la lista base. La diferencia se actualiza al editar el
            precio. Editar una celda no crea registros hasta guardar. Puedes
            pegar una columna de precios desde Excel. Los precios con historial
            pueden desactivarse, pero no eliminarse.
          </small>
        </>
      )}
      {variantProduct && (
        <VariantManager
          company={company}
          product={variantProduct}
          onClose={() => setVariantProduct(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}
import { variantLabel } from "./variant-label";
