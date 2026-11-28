import { inventoryRequest } from "./InventoryAdjustment";
import { useEffect, useRef, useState } from "react";
import { AppButton } from "./AppIcon";
import { request } from "./commerce";
import { confirmAction } from "./ConfirmDialog";
import { keyedRequest, useOperation, type Row } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import SearchSelect from "./SearchSelect";
import { parseNumber, parseTSV } from "./sheet-model";
import "./wall-to-wall.css";

const states: Record<string, string> = { open: "Abierto", confirmed: "Confirmado", cancelled: "Cancelado" };
const blankEntry = { article: "", unit_id: "", quantity: "", location: "", notes: "" };
const articleKey = (row: Row) => row.item_kind + ":" + row.item_id;
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const stamp = (value: string) => new Date(value).toLocaleString("es-GT", { timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short" });
const day = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Guatemala" }).format(new Date(value));
const qty = (value: unknown) => Number(value).toLocaleString("es-GT", { maximumFractionDigits: 8 });
const percent = (part: number, total: number) => total ? Math.round(1000 * part / total) / 10 : 0;

function matches(query: string, ...values: unknown[]) {
  return normalize(values.join(" ")).includes(normalize(query));
}

export default function InventoryWallToWall({ company, onClose, onPosted }: {
  company: string; onClose: () => void; onPosted: () => Promise<void>;
}) {
  const state = useOperation(company, "inventory");
  const read = (action: string, data: Row = {}) => request("wall_to_wall", {
    p_company: company, p_action: action, p_data: data,
  });
  const write = (action: string, data: Row) => keyedRequest(company, "wall_to_wall", data, action);
  const [sessions, setSessions] = useState<Row[]>([]);
  const [adjustmentDoc, setDocument] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [review, setReview] = useState<Row | null>(null);
  const [tab, setTab] = useState("Captura");
  const [create, setCreate] = useState(false);
  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [entry, setEntry] = useState(blankEntry);
  const [editing, setEditing] = useState<Row | null>(null);
  const [changed, setChanged] = useState(false);
  const [paste, setPaste] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionStatus, setSessionStatus] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [recordUser, setRecordUser] = useState("");
  const [recordDate, setRecordDate] = useState("");
  const [recordKind, setRecordKind] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [filter, setFilter] = useState("");
  const captureRef = useRef<HTMLFormElement>(null);

  const load = async () => setSessions(await read("list"));
  useEffect(() => { void state.run(load); }, [company]);
  const session = detail?.session;
  const articles: Row[] = detail?.articles ?? [];
  const units: Row[] = detail?.units ?? [];
  const entries: Row[] = detail?.entries ?? [];
  const selected = articles.find(a => articleKey(a) === entry.article);
  const active = session?.state === "open" && state.canWrite;
  const rows: Row[] = review?.rows ?? [];
  const affected = rows.filter(r => Number(r.physical) > 0 && !Number(r.records));
  const conflicted = rows.filter(r => r.protected || r.stale);
  const adjusted = rows.filter(r => Number(r.difference) !== 0);
  const covered = rows.filter(r => Number(r.records) > 0).length;
  const compatible = (article?: Row) => article ? units.filter(unit => article.item_kind === "variant"
    ? unit.id === article.unit_id
    : unit.dimension === units.find(u => u.id === article.unit_id)?.dimension) : [];

  async function open(id: string) {
    const next = await read("detail", { session: id });
    setDetail(next);setDocument(null);
    setTab(next.session.state === "open" ? "Captura" : "Consolidado");
    setReview(next.session.state === "confirmed" ? await read("review", { session: id }) : null);
    setChanged(false); setEntry(blankEntry); setEditing(null); setPaste("");
  }

  async function refresh() {
    setDetail(await read("detail", { session: session.id }));
    setChanged(true);
  }

  async function add() {
    if (!selected || !active) return;
    await write("add", { session: session.id, entries: [{ ...entry, item_id: selected.item_id, item_kind: selected.item_kind }] });
    await refresh();
    setEntry(blankEntry);
    captureRef.current?.querySelector<HTMLInputElement>("input[data-search-select]")?.focus();
  }

  async function importRows() {
    const lines = parseTSV(paste).filter(row => row.some(cell => cell.trim()));
    const first = normalize(lines[0]?.[0]);
    if (["articulo","sku","codigo","producto","material"].includes(first)) lines.shift();
    if (!lines.length) throw Error("Pega al menos una fila.");
    const imported = lines.map(([name, raw, unit, location, notes], index) => {
      const candidate = articles.filter(a => [a.name, a.sku, a.barcode].some(v => normalize(v) && normalize(v) === normalize(name)));
      if (candidate.length !== 1) throw Error(`Fila ${index + 1}: el artículo no se identifica de forma única.`);
      const a = candidate[0];
      const amount = raw?.trim() ? parseNumber(raw) : NaN;
      const input = unit?.trim() ? compatible(a).find(u => [u.symbol, u.name].some(v => normalize(v) === normalize(unit)))?.id : a.unit_id;
      if (amount == null || !Number.isFinite(amount) || amount < 0 || !input)
        throw Error(`Fila ${index + 1}: revisa cantidad o unidad.`);
      return { item_id:a.item_id,item_kind:a.item_kind,quantity:amount,unit_id:input,location,notes };
    });
    await write("add", { session: session.id, entries: imported });
    await refresh();
    setPaste("");
  }

  async function consolidate() {
    setReview(await read("review", { session: session.id }));
    setChanged(false);
  }

  async function confirm() {
    if (!review || changed || conflicted.length) return;
    const prompt = affected.length
      ? `Hay ${affected.length} artículos con existencias positivas sin contar. Esas existencias se ajustarán a cero. ¿Confirmas los ajustes definitivos?`
      : `Se ajustarán ${adjusted.length} artículos. ¿Confirmas los ajustes definitivos?`;
    if (!(await confirmAction(prompt, { confirmText: "Confirmar ajustes" }))) return;
    try {
      await write("confirm", { session: session.id, proof: review.proof, acknowledged: true });
    } catch (error) {
      await consolidate();
      throw error;
    }
    await open(session.id);
    await onPosted();
  }

  const entryCells = (record: Row) => {
    const article = articles.find(a => articleKey(a) === articleKey(record));
    return { name: article?.name ?? record.item_id, unit: record.unit,
      user: record.user_name, date: stamp(record.created_at), baseUnit: article?.unit };
  };
  const recordList = (records: Row[], actions = false) => <ul className="wtw-records">
    {records.map(record => {
      const info = entryCells(record);
      return <li key={record.id}><strong>{info.name}</strong>
        <span>{qty(record.quantity)} {info.unit} · {info.date}</span>
        {actions&&<span>{info.user} · {qty(record.base_quantity)} {info.baseUnit}</span>}
        {record.location&&<small>{record.location}</small>}{record.notes&&<small>{record.notes}</small>}
        {actions&&active&&<div className="actions">
          <AppButton className="secondary" disabled={state.busy} onClick={()=>setEditing(record)}>Editar</AppButton>
          <AppButton className="secondary" disabled={state.busy} onClick={()=>void state.run(async()=>{
            if (!await confirmAction("¿Eliminar esta captura? Se conservará su historial.")) return;
            await write("delete",{session:session.id,entry:record.id,revision:record.revision});await refresh();
          })}>Eliminar</AppButton>
        </div>}
      </li>;
    })}
  </ul>;

  const viewRows = rows.filter(r => (!kind||r.item_kind===kind)&&matches(query,r.name,r.sku,r.barcode)&&(
    !filter || (filter==="counted"&&r.records>0) || (filter==="uncounted"&&!Number(r.records)) ||
    (filter==="positive"&&r.difference>0) || (filter==="negative"&&r.difference<0) ||
    (filter==="equal"&&Number(r.difference)===0) || (filter==="shortage"&&r.reservation_shortage>0)));
  const viewSessions=sessions.filter(r=>(!sessionStatus||r.state===sessionStatus)&&(!sessionDate||day(r.created_at)===sessionDate)&&matches(sessionQuery,r.number,r.description));
  const filteredEntries = entries.filter(r => {
    const info = entryCells(r);
    return (!recordKind||r.item_kind===recordKind)&&(!recordDate||day(r.created_at)===recordDate)&&
      (!recordUser||r.created_by===recordUser)&&matches(recordQuery,info.name,r.location,r.notes);
  });

  return <div className="overlay wtw-overlay"><section className="modal wtw-dialog" role="dialog" aria-modal="true" aria-label="Levantamiento de inventario">
    <header className="wtw-header">
      <h2>{session ? `Levantamiento #${session.number}` : "Levantamientos de inventario"}</h2>
      <AppButton className="secondary" disabled={state.busy} onClick={()=>{if(session){setDetail(null);void state.run(load);}else onClose();}}>{session?"Volver al listado":"Cerrar"}</AppButton>
    </header>
    <div className="wtw-body">
      {state.error&&<p className="error" role="alert">{state.error}</p>}
      {!session?<>
        {state.canWrite&&<AppButton disabled={state.busy} onClick={()=>setCreate(!create)}>Nuevo levantamiento</AppButton>}
        {create&&<form className="wtw-fields" onSubmit={event=>{event.preventDefault();void state.run(async()=>{
          const result=await write("create",{description,notes:observations});setCreate(false);setDescription("");setObservations("");await open(result.id);
        });}}>
          <label>Descripción<input required maxLength={200} value={description} onChange={e=>setDescription(e.target.value)}/></label>
          <label>Observaciones<textarea maxLength={2000} value={observations} onChange={e=>setObservations(e.target.value)}/></label>
          <AppButton disabled={state.busy}>Crear sesión</AppButton>
        </form>}
        <div className="wtw-fields">
          <label>Buscar levantamiento<input type="search" value={sessionQuery} onChange={e=>setSessionQuery(e.target.value)}/></label>
          <label>Estado<SearchSelect value={sessionStatus} onChange={e=>setSessionStatus(e.target.value)}><option value="">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchSelect></label>
          <label>Fecha<input type="date" value={sessionDate} onChange={e=>setSessionDate(e.target.value)}/></label>
        </div>
        <ul className="wtw-session-cards wtw-records">{viewSessions.map(r=><li key={r.id}>
          <AppButton className="secondary" onClick={()=>void state.run(()=>open(r.id))}>#{r.number} · {r.description}</AppButton>
          <span>{states[r.state]} · {r.record_count} capturas · {r.article_count} artículos · {percent(r.article_count,r.total_articles)}%</span>
          <small>{stamp(r.created_at)} · {r.responsible}</small>
          {r.confirmed_at&&<small>Confirmado {stamp(r.confirmed_at)}</small>}
        </li>)}</ul>
        <div className="wtw-session-desktop"><ResponsiveTable className="wtw-session-table"><thead><tr><th>Número</th><th>Descripción</th><th>Creación</th><th>Confirmación</th><th>Estado</th><th>Capturas</th><th>Contados</th><th>Cobertura</th><th>Responsable</th></tr></thead>
          <tbody>{viewSessions.map(r=><tr key={r.id}>
            <td><AppButton className="secondary" onClick={()=>void state.run(()=>open(r.id))}>#{r.number}</AppButton></td><td>{r.description}</td>
            <td data-sort-value={r.created_at}>{stamp(r.created_at)}</td><td data-sort-value={r.confirmed_at??""}>{r.confirmed_at?stamp(r.confirmed_at):"—"}</td>
            <td>{states[r.state]}</td><td>{r.record_count}</td><td>{r.article_count}</td><td>{percent(r.article_count,r.total_articles)}%</td><td>{r.responsible}</td>
          </tr>)}</tbody></ResponsiveTable></div>
      </>:<>
        <p><strong>{session.description}</strong> · {states[session.state]} · {entries.length} capturas · {new Set(entries.map(articleKey)).size} artículos</p>
        {detail?.document&&<AppButton className="secondary" disabled={state.busy} onClick={()=>void state.run(async()=>{
          setDocument(adjustmentDoc?null:await inventoryRequest(company,"detail",{id:session.document_id}));
        })}>{adjustmentDoc?"Ocultar documento":`Ver documento de ajuste #${detail.document}`}</AppButton>}
        {adjustmentDoc&&<ul className="wtw-records" aria-label="Líneas del documento de ajuste">{adjustmentDoc.lines.map((line:Row)=><li key={line.id}>
          <strong>{line.snapshot?.name}</strong>
          <span>{line.snapshot?.count_direction<0?"Salida":"Entrada"} · {qty(line.base_quantity)} {line.snapshot?.unit}</span>
        </li>)}</ul>}
        <div role="group" className="wtw-tabs" aria-label="Secciones del levantamiento">
          {["Captura","Registros","Consolidado"].map(name=><AppButton key={name} className="secondary" aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</AppButton>)}
        </div>
        {tab==="Captura"&&<>
          {active&&<form ref={captureRef} id="wtw-capture" className="wtw-fields" onSubmit={e=>{e.preventDefault();void state.run(add);}}>
            <label>Material o producto<SearchSelect required value={entry.article} resolveText={value=>{
              const search=normalize(value.trim());
              const matches=articles.filter(a=>[a.name,a.sku,a.barcode].some(term=>term&&normalize(term)===search));
              return matches.length===1 ? articleKey(matches[0]) : undefined;
            }} onChange={e=>{
              const a=articles.find(row=>articleKey(row)===e.target.value);
              setEntry({...blankEntry,article:e.target.value,unit_id:a?.unit_id??""});
            }}><option value="">Buscar por nombre, SKU o código de barras</option>
              {articles.map(a=><option key={articleKey(a)} value={articleKey(a)}>{[a.name,a.sku,a.barcode].filter(Boolean).join(" · ")}</option>)}
            </SearchSelect></label>
            {selected&&<>
              <p>{selected.sku||"—"} · Kardex {qty(selected.physical)} {selected.unit} · Reservado {qty(selected.reserved)} · Disponible {qty(Number(selected.physical)-Number(selected.reserved)-Number(selected.blocked))} · Acumulado {qty(entries.filter(e=>articleKey(e)===entry.article).reduce((sum,e)=>sum+Number(e.base_quantity),0))}</p>
              <label>Unidad<SearchSelect required value={entry.unit_id} onChange={e=>setEntry({...entry,unit_id:e.target.value})}>{compatible(selected).map(u=><option key={u.id} value={u.id}>{u.name} · {u.symbol}</option>)}</SearchSelect></label>
              <label>Cantidad física<input required type="number" inputMode={selected.item_kind==="variant"?"numeric":"decimal"} min="0" step={selected.item_kind==="variant"?1:"any"} value={entry.quantity} onChange={e=>setEntry({...entry,quantity:e.target.value})}/></label>
              <label>Ubicación<input maxLength={250} value={entry.location} onChange={e=>setEntry({...entry,location:e.target.value})}/></label>
              <label>Observaciones<input maxLength={1000} value={entry.notes} onChange={e=>setEntry({...entry,notes:e.target.value})}/></label>
            </>}
          </form>}
          <h3>Últimas capturas</h3>{recordList(entries.slice(0,5))}
        </>}
        {tab==="Registros"&&<>
          <div className="wtw-fields">
            <label>Buscar registro<input type="search" value={recordQuery} onChange={e=>setRecordQuery(e.target.value)}/></label>
            <label>Tipo<SearchSelect value={recordKind} onChange={e=>setRecordKind(e.target.value)}><option value="">Todos</option><option value="material">Materiales</option><option value="variant">Productos</option></SearchSelect></label>
            <label>Usuario<SearchSelect value={recordUser} onChange={e=>setRecordUser(e.target.value)}><option value="">Todos</option>{[...new Map(entries.map(r=>[r.created_by,r.user_name]))].map(([id,name])=><option key={id} value={id}>{name}</option>)}</SearchSelect></label>
            <label>Fecha<input type="date" value={recordDate} onChange={e=>setRecordDate(e.target.value)}/></label>
          </div>
          {active&&<details><summary>Pegar filas desde Excel</summary>
            <label>Artículo, cantidad, unidad, ubicación y observaciones<textarea value={paste} onChange={e=>setPaste(e.target.value)}/></label>
            <AppButton disabled={state.busy||!paste.trim()} onClick={()=>void state.run(importRows)}>Registrar filas</AppButton>
          </details>}
          {editing&&<form className="wtw-fields" onSubmit={e=>{e.preventDefault();void state.run(async()=>{
            await write("edit",{session:session.id,entry:editing.id,revision:editing.revision,quantity:editing.quantity,unit_id:editing.unit_id,location:editing.location,notes:editing.notes,recounted:!!editing.recounted});setEditing(null);await refresh();
          });}}>
            <strong>Editar {entryCells(editing).name}</strong>
            <label>Unidad<SearchSelect required value={editing.unit_id} onChange={e=>setEditing({...editing,unit_id:e.target.value})}>{compatible(articles.find(a=>articleKey(a)===articleKey(editing))).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</SearchSelect></label>
            <label>Cantidad<input required type="number" min="0" step={editing.item_kind==="variant"?1:"any"} value={editing.quantity} onChange={e=>setEditing({...editing,quantity:e.target.value})}/></label>
            <label>Ubicación<input maxLength={250} value={editing.location} onChange={e=>setEditing({...editing,location:e.target.value})}/></label>
            <label>Observaciones<input maxLength={1000} value={editing.notes} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label>
            <label><input type="checkbox" checked={!!editing.recounted} onChange={e=>setEditing({...editing,recounted:e.target.checked})}/> Volví a comprobar físicamente esta captura</label>
            <AppButton disabled={state.busy}>Guardar corrección</AppButton><AppButton type="button" className="secondary" onClick={()=>setEditing(null)}>Cancelar edición</AppButton>
          </form>}
          {recordList(filteredEntries,true)}
        </>}
        {tab==="Consolidado"&&<>
          {session.state==="open"&&<AppButton disabled={state.busy} onClick={()=>void state.run(consolidate)}>Consolidar inventario</AppButton>}
          {changed&&<p role="status">Hay capturas nuevas o corregidas. Actualiza el consolidado.</p>}
          {review&&<>
            <p>{rows.length} artículos · {covered} contados · {rows.length-covered} sin conteo · {percent(covered,rows.length)}% de cobertura</p>
            <p>{rows.filter(r=>r.difference>0).length} positivos · {rows.filter(r=>r.difference<0).length} negativos · {rows.filter(r=>Number(r.difference)===0).length} sin diferencia · {rows.filter(r=>r.reservation_shortage>0).length} bajo reservas</p>
            {affected.length>0&&<p role="alert">{affected.length} artículos tienen existencias positivas sin conteo. Esas existencias se ajustarán a cero.</p>}
            {conflicted.length>0&&<p role="alert">Revisa estas existencias antes de confirmar: {conflicted.map(r=>r.name).join(", ")}.</p>}
            <div className="wtw-fields">
              <label>Buscar artículo<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
              <label>Tipo<SearchSelect value={kind} onChange={e=>setKind(e.target.value)}><option value="">Todos</option><option value="material">Materiales</option><option value="variant">Productos</option></SearchSelect></label>
              <label>Resultado<SearchSelect value={filter} onChange={e=>setFilter(e.target.value)}>{[["","Todos"],["counted","Contados"],["uncounted","Sin conteo"],["positive","Diferencias positivas"],["negative","Diferencias negativas"],["equal","Sin diferencias"],["shortage","Faltante para cubrir reservas"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchSelect></label>
            </div>
            <div className="wtw-session-desktop table-wrap">
              <ResponsiveTable><thead><tr><th>Código</th><th>Artículo</th><th>UM</th><th>Kardex</th><th>Reservado</th><th>Disponible</th><th>Contado</th><th>Diferencia</th><th>Registros</th><th>Estado</th></tr></thead>
                <tbody>{viewRows.map(r=><tr key={articleKey(r)}><td>{r.sku||"—"}</td><td><button type="button" className="secondary" onClick={()=>{
                  const target=document.getElementById(`wtw-row-${articleKey(r)}`) as HTMLDetailsElement|null;if(target){target.open=true;target.scrollIntoView({block:"nearest"});}
                }}>{r.name}</button></td><td>{r.unit}</td>
                  {["physical","reserved","available","counted","difference","records"].map(field=><td key={field} data-sort-value={r[field]}
                    data-diff={field==="difference"?Math.sign(Number(r[field])):undefined}>{qty(r[field])}</td>)}
                  <td>{r.records?"Contado":"Sin conteo"}</td></tr>)}</tbody>
              </ResponsiveTable>
            </div>
            <div className="wtw-results">{viewRows.map(r=><details key={articleKey(r)} id={`wtw-row-${articleKey(r)}`}>
              <summary><strong>{r.name}</strong> {r.sku} · {r.records?"Contado":"Sin conteo"} · <span data-diff={Math.sign(Number(r.difference))}>{qty(r.difference)} {r.unit}</span></summary>
              <p>Kardex {qty(r.physical)} · Reservado {qty(r.reserved)} · Disponible {qty(r.available)} · Contado {qty(r.counted)} {r.unit} · {r.records} capturas</p>
              {r.stale&&<p>Movimiento físico posterior al conteo. Verifica y corrige las capturas.</p>}
              {r.protected&&<p>Las existencias utilizables no cubren la salida sin afectar reservas o existencias bloqueadas, o falta una unidad de medida.</p>}
              {recordList(entries.filter(e=>articleKey(e)===articleKey(r)))}
            </details>)}</div>
          </>}
        </>}
      </>}
    </div>
    {active&&<footer className="wtw-footer">
      {tab==="Captura"&&<AppButton disabled={state.busy||!selected} form="wtw-capture" type="submit">Registrar conteo</AppButton>}
      {tab==="Consolidado"&&<AppButton disabled={state.busy||!review||changed||!!conflicted.length} onClick={()=>void state.run(confirm)}>Confirmar ajustes de inventario</AppButton>}
      <AppButton className="secondary" disabled={state.busy} onClick={()=>void state.run(async()=>{
        if (!await confirmAction("¿Cancelar este levantamiento abierto? El inventario queda intacto.")) return;
        await write("cancel",{session:session.id});setDetail(null);await load();
      })}>Cancelar levantamiento</AppButton>
    </footer>}
  </section></div>;
}
