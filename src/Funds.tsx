import { useEffect, useState, type FormEvent } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { supabase as db } from "./client";
import { salesWorklist } from "./commerce";
import { operationFinished, operationStarted } from "./navigation-protection";
import { keyedRequest, money, today, type Row } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import { openSaleDocument } from "./SaleDocument";

const labels: Record<string, string> = {
  sale: "Venta", expense: "Salida", transfer: "Transferencia",
  reversal: "Anulación", pending: "Pendiente de costos",
};
const totals = ["sales", "expenses", "reversals", "transfers", "balance"];
const pageSize = 50;
const fundId = (fund: Row) => fund.currency + "/" + fund.fund_key;
const initialFilters = { from: "", to: "", fund: "", kind: "", document: "" };
const initialEntry = () => ({ origin: "", destination: "", amount: "", date: today(), description: "", reference: "" });

export default function Funds({ company }: { company: string }) {
  const [balances, setBalances] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [mode, setMode] = useState<"expense" | "transfer" | "">("");
  const [entry, setEntry] = useState(initialEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const origin = balances.find((fund) => fundId(fund) === entry.origin);
  const currencies = [...new Set(balances.map((fund) => fund.currency))];

  async function load(next = applied, nextPage = page, includeHistory = historyLoaded) {
    let query = db.from("fund_movements").select("*").eq("company_id", company);
    if (next.from) query = query.gte("occurred_on", next.from);
    if (next.to) query = query.lte("occurred_on", next.to);
    if (next.kind) query = query.eq("kind", next.kind);
    if (next.fund) {
      const [currency, key] = next.fund.split("/");
      query = query.eq("fund_key", key).eq("currency", currency);
    }
    if (next.document.trim()) {
      const number = next.document.trim().replace(/^#/, "");
      query = /^\d+$/.test(number)
        ? query.or(`document_number.eq.${number},reference.eq.${number}`)
        : query.eq("reference", next.document.trim());
    }
    const [summary, rows] = await Promise.all([
      db.from("fund_balances").select("*").eq("company_id", company).order("fund_name"),
      includeHistory ? query.order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
        .order("id").range(nextPage * pageSize, (nextPage + 1) * pageSize) : null,
    ]);
    if (summary.error) throw summary.error;
    if (rows?.error) throw rows.error;
    setBalances(summary.data);
    if (!rows) return;
    setHistoryLoaded(true);
    setHistory(rows.data.slice(0, pageSize));
    setMore(rows.data.length > pageSize);
    setPage(nextPage);
    setApplied(next);
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await work(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  useEffect(() => { void run(() => load(initialFilters, 0)); }, [company]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!origin) return;
    const destination = balances.find((fund) => fundId(fund) === entry.destination);
    if (mode === "transfer" && (!destination || destination.currency !== origin.currency)) return;
    void run(async () => {
      operationStarted();
      let saved = false;
      try {
        await keyedRequest(company, "record_fund_movement", {
          ...entry, origin: origin.fund_key, currency: origin.currency,
          destination: mode === "transfer" ? destination?.fund_key : "",
        });
        saved = true;
        setEntry(initialEntry());
        setMode("");
        setNotice(mode === "transfer" ? "Transferencia registrada." : "Salida registrada.");
        await load();
      } finally {
        operationFinished(saved);
      }
    });
  }

  return <>
    <section className="intro">
      <h1><AppIcon name="module.funds" /> Fondos</h1>
      <div className="actions">
        <AppButton iconKey="action.add" disabled={busy || !balances.length || !!mode} onClick={() => setMode("expense")}>Registrar salida</AppButton>
        <AppButton className="secondary" iconKey="control.sort" disabled={busy || !balances.some((a) => balances.some((b) => a !== b && a.currency === b.currency)) || !!mode} onClick={() => setMode("transfer")}>Transferir entre fondos</AppButton>
        <AppButton className="secondary" disabled={busy} onClick={() => run(() => load())}>Actualizar</AppButton>
      </div>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {mode && <section className="catalog">
      <div className="catalog-head"><h2>{mode === "transfer" ? "Transferir entre fondos" : "Registrar salida"}</h2></div>
      <form className="form-grid" onSubmit={save} aria-busy={busy}>
        <label>{mode === "transfer" ? "Fondo de origen" : "Fondo"}
          <select required value={entry.origin} onChange={(e) => setEntry({ ...entry, origin: e.target.value, destination: "" })}>
            <option value="">Seleccionar</option>
            {balances.map((fund) => <option key={fundId(fund)} value={fundId(fund)}>{fund.fund_name} · {fund.currency}</option>)}
          </select>
        </label>
        {mode === "transfer" && <label>Fondo de destino
          <select required value={entry.destination} onChange={(e) => setEntry({ ...entry, destination: e.target.value })}>
            <option value="">Seleccionar</option>
            {balances.filter((fund) => fund.currency === origin?.currency && fundId(fund) !== entry.origin)
              .map((fund) => <option key={fundId(fund)} value={fundId(fund)}>{fund.fund_name}</option>)}
          </select>
        </label>}
        <label>Monto{origin ? " · " + origin.currency : ""}<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></label>
        <label>Fecha<input required type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></label>
        <label>Concepto<input required maxLength={500} value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></label>
        <label>Referencia opcional<input maxLength={200} value={entry.reference} onChange={(e) => setEntry({ ...entry, reference: e.target.value })} /></label>
        <div className="actions"><AppButton type="submit" disabled={busy}>Guardar</AppButton>
          <AppButton className="secondary" disabled={busy} onClick={() => { setEntry(initialEntry()); setMode(""); }}>Cancelar</AppButton></div>
      </form>
    </section>}
    <section className="catalog">
      <div className="catalog-head"><h2>Resumen de fondos</h2></div>
      <ResponsiveTable>
        <thead><tr>{["Fondo", "Ventas", "Salidas", "Anulaciones", "Transferencias", "Saldo"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{balances.map((fund) => <tr key={fundId(fund)}>
          <td>{fund.fund_name} · {fund.currency}</td>
          {totals.map((key) => <td key={key}>{money(fund[key], fund.currency)}</td>)}
        </tr>)}</tbody>
        <tfoot>{currencies.map((currency) => <tr key={currency}>
          <th scope="row">Total general · {currency}</th>
          {totals.map((key) => <td key={key}>{money(balances.filter((fund) => fund.currency === currency).reduce((sum, fund) => sum + Number(fund[key]), 0), currency)}</td>)}
        </tr>)}</tfoot>
      </ResponsiveTable>
      {!balances.length && <p className="muted">Aún no hay fondos con movimientos.</p>}
    </section>
    <section className="catalog">
      <div className="catalog-head"><h2>Historial de movimientos</h2></div>
      <form className="form-grid" data-dirty-managed onSubmit={(e) => { e.preventDefault(); void run(() => load(filters, 0, true)); }}>
        <label>Desde<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Hasta<input type="date" min={filters.from || undefined} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label>Fondo<select value={filters.fund} onChange={(e) => setFilters({ ...filters, fund: e.target.value })}>
          <option value="">Todos</option>
          {balances.map((fund) => <option key={fundId(fund)} value={fundId(fund)}>{fund.fund_name} · {fund.currency}</option>)}
        </select></label>
        <label>Tipo<select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>
          <option value="">Todos</option>
          {Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select></label>
        <label>Factura o referencia exacta<input value={filters.document} onChange={(e) => setFilters({ ...filters, document: e.target.value })} /></label>
        <div className="actions"><AppButton type="submit" disabled={busy}>Filtrar</AppButton>
          <AppButton className="secondary" disabled={busy} onClick={() => { setFilters(initialFilters); setHistoryLoaded(false); setHistory([]); setApplied(initialFilters); setPage(0); setMore(false); }}>Limpiar</AppButton></div>
      </form>
      {historyLoaded && <ResponsiveTable>
        <thead><tr>{["Fecha", "Tipo", "Documento", "Cliente", "Producto", "Fondo", "Concepto", "Importe", "Acciones"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{history.map((row) => <tr key={row.id}>
          <td>{row.occurred_on}</td><td>{labels[row.kind]}</td>
          <td>{row.document_number != null ? "#" + row.document_number : row.reference || "—"}</td>
          <td>{row.customer_name || "—"}</td><td>{row.product_name || "—"}</td>
          <td>{row.fund_name}</td><td>{row.description}</td>
          <td>{row.kind === "pending" ? "Pendiente" : money(row.amount, row.currency)}</td>
          <td><AppButton className="secondary" onClick={() => setDetail(row)}>Ver detalle</AppButton></td>
        </tr>)}</tbody>
      </ResponsiveTable>}
      {!history.length && <p className="muted">{historyLoaded ? "No hay movimientos para esta consulta." : "Pulsa Filtrar para cargar el historial."}</p>}
      {historyLoaded && <div className="actions">
        <AppButton className="secondary" disabled={busy || page === 0} onClick={() => run(() => load(applied, page - 1))}>Anterior</AppButton>
        <AppButton className="secondary" disabled={busy || !more} onClick={() => run(() => load(applied, page + 1))}>Siguiente</AppButton>
      </div>}
    </section>
    {detail && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Detalle del movimiento">
      <h2>{labels[detail.kind]} · {detail.fund_name}</h2>
      <p>{detail.description} · {detail.occurred_on}</p>
      {detail.kind !== "pending" && <p>{money(detail.amount, detail.currency)}</p>}
      {detail.reference && <p>Referencia · {detail.reference}</p>}
      {detail.detail?.reasons?.map((reason: string) => <p key={reason}>{reason}</p>)}
      {detail.detail?.counterpart && <p>{detail.amount < 0 ? "Destino" : "Origen"} · {detail.detail.counterpart}</p>}
      {detail.detail?.costs?.length > 0 && <p>
        Origen de costos · {[...new Set<string>(detail.detail.costs.map((cost: Row) =>
          cost.source?.basis === "current_formula" ? `Fórmula vigente v${cost.source.version}` : "Producción histórica"
        ))].join(", ")}
      </p>}
      <div className="actions">
        {detail.order_id && <AppButton className="secondary" onClick={() => {
          if (!openSaleDocument(() => salesWorklist(company, "detail", { order: detail.order_id }), "invoice")) {
            setError("Permite las ventanas emergentes para abrir la factura.");
          }
        }}>Ver factura</AppButton>}
        <AppButton className="secondary" onClick={() => setDetail(null)}>Cerrar</AppButton>
      </div>
    </section></div>}
  </>;
}
