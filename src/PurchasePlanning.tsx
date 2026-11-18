import { useEffect, useState } from "react";
import { AppButton } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import SearchSelect from "./SearchSelect";
import { SearchField } from "./PoolControls";
import { operation, mutate, useOperation, type Row } from "./operations";

type DraftLine = {
  key: string;
  id?: string;
  revision?: number;
  material_id: string;
  supplier_id: string;
  unit_id: string;
  quantity: string;
  notes: string;
};
const blankLine = (): DraftLine => ({
  key: crypto.randomUUID(), material_id: "", supplier_id: "", unit_id: "", quantity: "", notes: "",
});
const quantity = (value: unknown) => Number(value).toLocaleString("es-GT", { maximumFractionDigits: 8 });

export default function PurchasePlanning({ company, catalog, refresh }: {
  company: string; catalog: Row; refresh: number;
}) {
  const state = useOperation(company, "inventory");
  const [lines, setLines] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("pending");
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  const [original, setOriginal] = useState("");
  const dirty = draft !== null && JSON.stringify(draft) !== original;

  async function load() {
    const rows = await operation(company, "purchase_plan");
    setLines(rows);
    setLoading(false);
  }
  useEffect(() => { void state.run(load); }, [company, refresh]);

  function open(row?: Row) {
    const next: DraftLine[] = row ? [{
      key: row.id, id: row.id, revision: row.revision, material_id: row.material_id,
      supplier_id: row.supplier_id || "", unit_id: row.unit_id,
      quantity: String(row.quantity), notes: row.notes,
    }] : [blankLine()];
    setDraft(next);
    setOriginal(JSON.stringify(next));
    state.setError("");
  }
  async function close() {
    if (state.busy) return;
    if (dirty && !await confirmAction("¿Salir de la orden de compra sin guardar los cambios?")) return;
    setDraft(null);
    state.setError("");
  }
  function change(key: string, patch: Partial<DraftLine>) {
    setDraft(current => current?.map(line => line.key === key ? { ...line, ...patch } : line) ?? null);
  }

  const visible = lines.filter(line =>
    (filter === "all" || (filter === "purchased" ? line.purchased : !line.purchased)) &&
    [line.material, line.sku, line.supplier, line.notes].join(" ").toLocaleLowerCase("es-GT").includes(query.toLocaleLowerCase("es-GT")),
  );
  return <section className="catalog">
    <div className="catalog-head">
      <h2>Orden de compra</h2>
      {state.canWrite && <AppButton disabled={state.busy} onClick={() => open()}>Agregar materiales</AppButton>}
    </div>
    <div className="toolbar">
      <SearchField aria-label="Buscar en la orden de compra" placeholder="Material, SKU, proveedor o notas"
        value={query} onChange={event => setQuery(event.target.value)} />
      <label>Mostrar<SearchSelect value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="pending">Pendientes</option>
        <option value="purchased">Comprados</option>
        <option value="all">Todos</option>
      </SearchSelect></label>
    </div>
    {state.error && !draft && <p className="error" role="alert">{state.error}</p>}
    {state.notice && <p role="status">{state.notice}</p>}
    <div className="table-wrap"><ResponsiveTable showAllMobileFields>
      <thead><tr><th>Comprado</th><th>Material</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Notas</th><th>Acciones</th></tr></thead>
      <tbody>{visible.map(line => <tr key={line.id}>
        <td data-sort-value={line.purchased ? 1 : 0}><label>
          <input type="checkbox" checked={line.purchased} disabled={state.busy || !state.canWrite}
            aria-label={`Marcar ${line.material} como comprado`}
            onChange={event => {
              const purchased = event.target.checked;
              void state.run(async () => {
                await mutate(company, "purchase_plan_mark", { id: line.id, revision: line.revision, purchased });
                await load();
              });
            }} /> {line.purchased ? "Comprado" : "Pendiente"}
        </label></td>
        <td>{line.material}{line.sku && <small>{line.sku}</small>}</td>
        <td>{line.supplier || "Por definir"}</td>
        <td data-sort-value={line.quantity}>{quantity(line.quantity)}</td>
        <td>{line.unit}</td><td>{line.notes || "—"}</td>
        <td className="actions">{state.canWrite && <>
          <AppButton className="secondary" disabled={state.busy} onClick={() => open(line)}>Editar</AppButton>
          <AppButton className="secondary" disabled={state.busy} onClick={() => state.run(async () => {
            if (!await confirmAction(`¿Eliminar ${line.material} de la orden de compra?`)) return;
            await mutate(company, "purchase_plan_delete", { id: line.id, revision: line.revision });
            await load();
          })}>Eliminar</AppButton>
        </>}</td>
      </tr>)}</tbody>
    </ResponsiveTable></div>
    {!visible.length && <p className="empty">{loading ? "Consultando orden de compra…" : "No hay materiales para estos filtros."}</p>}
    {draft && <div className="overlay">
      <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-plan-title"
        data-navigation-dirty={dirty}>
        <header className="hierarchy-toolbar">
          <h2 id="purchase-plan-title">{draft[0]?.id ? "Editar línea" : "Agregar a la orden de compra"}</h2>
          <AppButton className="secondary" disabled={state.busy} onClick={() => void close()}>Cerrar</AppButton>
        </header>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <form onSubmit={event => {
          event.preventDefault();
          void state.run(async () => {
            await mutate(company, "purchase_plan_save", {
              lines: draft.map(({ key: _key, ...line }) => line),
            });
            setDraft(null);
            state.setNotice("Orden de compra guardada.");
            await load();
          });
        }}>
          {draft.map((line, index) => {
            const material = catalog.materials.find((item: Row) => item.id === line.material_id);
            const baseUnit = catalog.units.find((item: Row) => item.id === material?.unit_id);
            return <fieldset key={line.key} className="settings-grid" disabled={state.busy}>
              <legend>Línea {index + 1}</legend>
              <label>Material<SearchSelect required value={line.material_id} onChange={event => {
                const selected = catalog.materials.find((item: Row) => item.id === event.target.value);
                change(line.key, { material_id: event.target.value, unit_id: selected?.unit_id || "" });
              }}>
                <option value="">Seleccionar</option>
                {!material && line.material_id && <option value={line.material_id} disabled>Material inactivo</option>}
                {catalog.materials.map((item: Row) => <option key={item.id} value={item.id}>{item.sku ? item.sku + " · " : ""}{item.name}</option>)}
              </SearchSelect></label>
              <label>Proveedor<SearchSelect value={line.supplier_id} onChange={event => change(line.key, { supplier_id: event.target.value })}>
                <option value="">Por definir</option>
                {catalog.suppliers.map((item: Row) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SearchSelect></label>
              <label>Cantidad<input type="number" required min="0.00000001" step="any"
                value={line.quantity} onChange={event => change(line.key, { quantity: event.target.value })} /></label>
              <label>Unidad<SearchSelect required value={line.unit_id} onChange={event => change(line.key, { unit_id: event.target.value })}>
                <option value="">Seleccionar</option>
                {catalog.units.filter((item: Row) => !baseUnit || item.dimension === baseUnit.dimension)
                  .map((item: Row) => <option key={item.id} value={item.id}>{item.name} ({item.symbol})</option>)}
              </SearchSelect></label>
              <label>Notas<textarea maxLength={2000} value={line.notes} onChange={event => change(line.key, { notes: event.target.value })} /></label>
              {draft.length > 1 && <AppButton type="button" className="secondary" onClick={() =>
                setDraft(current => current?.filter(item => item.key !== line.key) ?? null)}>Quitar línea</AppButton>}
            </fieldset>;
          })}
          <div className="form-actions">
            {!draft[0]?.id && <AppButton type="button" className="secondary" disabled={state.busy || draft.length >= 100}
              onClick={() => setDraft(current => [...(current || []), blankLine()])}>Agregar línea</AppButton>}
            <AppButton disabled={state.busy}>Guardar orden</AppButton>
            <AppButton type="button" className="secondary" disabled={state.busy} onClick={() => void close()}>Cancelar</AppButton>
          </div>
        </form>
      </section>
    </div>}
  </section>;
}
