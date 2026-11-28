import { Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import SearchSelect from "./SearchSelect";
import { supabase } from "./client";
import NoteEditor from "./NoteEditor";
import { NoteLabelBadge, NoteLabelForm } from "./NoteSettings";
import { compareNoteLabels, loadRows, markerIds, normalizeNoteText, noteFields, type Note, type NoteLabel } from "./noteWorkspace";
import "./notes.css";

type Action = "move" | "status" | "tags";
const UNASSIGNED = "-";
const byPosition = (a: Note, b: Note) => a.position - b.position || a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id);
const noteTitle = (note: Note) => note.title || "Sin título";

export default function Notes({ company, user, canManage, onDirty }: {
  company: string; user: string; canManage: boolean; onDirty: (dirty: boolean) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [labels, setLabels] = useState<NoteLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"groups" | "editor">("groups");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [order, setOrder] = useState("updated");
  const [menu, setMenu] = useState("");
  const [action, setAction] = useState<{ type: Action; note: Note }>();
  const [groupForm, setGroupForm] = useState<{ item?: NoteLabel }>();
  const [deletion, setDeletion] = useState<{ item: NoteLabel; count: number }>();
  const [draft, setDraft] = useState<Note | null>(null);
  const [base, setBase] = useState<Note | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const drag = useRef("");
  const groupDrag = useRef("");
  const actionForm = useRef<HTMLFormElement>(null);
  const selectedId = draft?.id;
  const dirty = !!draft && (draft.title !== base?.title || draft.body !== base?.body || draft.rich_body !== base?.rich_body ||
    draft.group_id !== base?.group_id || draft.status_id !== base?.status_id || draft.pinned !== base?.pinned ||
    markerIds(draft).join() !== (base && markerIds(base).join()));
  const pending = dirty || uploading || working || saveState === "saving";
  const leaveWarning = pending || !!groupForm || !!action;
  useEffect(() => {
    if (action) actionForm.current?.scrollIntoView({ block: "nearest" });
  }, [action]);

  const reload = useCallback(async () => {
    const [newNotes, newLabels] = await Promise.all([
      loadRows<Note>("production_notes", company, noteFields),
      loadRows<NoteLabel>("note_catalog", company, "*"),
    ]);
    setNotes(newNotes);
    setLabels(newLabels);
  }, [company]);

  useEffect(() => {
    void reload().catch(() => setError("No se pudieron cargar las notas."))
      .finally(() => setLoading(false));
  }, [reload]);
  useEffect(() => { onDirty(leaveWarning); return () => onDirty(false); }, [leaveWarning, onDirty]);
  useEffect(() => {
    if (!pending) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  async function persist(note: Note, expected: number | null) {
    const { data, error } = await supabase.rpc("save_note_workspace", {
      c: company, n: note.id, expected, fields: {
        title: note.title, body: note.body, rich_body: note.rich_body, group_id: note.group_id,
        status_id: note.status_id, pinned: note.pinned, position: note.position,
      }, markers: markerIds(note),
    }).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const saved = { ...(data as Note), note_markers: note.note_markers };
    setNotes(rows => [...rows.filter(row => row.id !== saved.id), saved]);
    return saved;
  }

  async function saveDraft() {
    if (!draft || !dirty || lock.current || uploading || saveState === "conflict") return;
    lock.current = true;
    setSaveState("saving");
    try {
      const saved = await persist(draft, base?.revision ?? null);
      if (saved) {
        setBase(saved);
        setDraft(current => current ? { ...current, revision: saved.revision, created_at: saved.created_at, updated_at: saved.updated_at } : current);
        setSaveState("saved");
      } else setSaveState("conflict");
    } catch {
      setSaveState("error");
    } finally {
      lock.current = false;
    }
  }

  useEffect(() => {
    if (!dirty || uploading || working || ["saving", "error", "conflict"].includes(saveState)) return;
    const timeout = window.setTimeout(() => { void saveDraft(); }, 900);
    return () => window.clearTimeout(timeout);
  });

  function open(note: Note) {
    setDraft(note);
    setBase(note);
    setSaveState("idle");
    setEditorKey(previous => previous + 1);
    setView("editor");
    setMenu("");
    setError("");
  }

  async function abandon() {
    if (uploading || lock.current) return false;
    return !dirty || await confirmAction("Hay cambios sin guardar. ¿Quieres salir de esta nota?");
  }

  async function openNote(note: Note) {
    if (note.id === selectedId) { setView("editor"); return; }
    if (await abandon()) open(note);
  }

  async function newNote(destination = UNASSIGNED) {
    if (!await abandon()) return;
    open({
      id: crypto.randomUUID(), author_id: user, title: "", body: "", rich_body: null, group_id: destination === UNASSIGNED ? null : destination,
      status_id: null, pinned: false, position: nextPosition, revision: null, created_at: null, updated_at: null, note_markers: [],
    });
  }

  async function updateNote(note: Note, patch: Partial<Note>) {
    if (lock.current || working) return false;
    if (selectedId === note.id && (dirty || note.revision === null)) {
      setDraft(current => current ? { ...current, ...patch } : current);
      return true;
    }
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      const saved = await persist({ ...note, ...patch }, note.revision);
      if (!saved) { setError("Esta nota cambió en otra sesión. Actualiza el listado antes de continuar."); return false; }
      if (saved.id === selectedId) {
        setBase(saved);
        setDraft(current => current ? { ...current, ...patch, revision: saved.revision, updated_at: saved.updated_at } : current);
      }
      return true;
    } catch {
      setError("No se pudo completar la acción.");
      return false;
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  async function removeNote(note: Note) {
    if (pending || lock.current || !await confirmAction("¿Eliminar «" + noteTitle(note) + "»?")) return;
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    const { data, error } = await supabase.from("production_notes").delete().eq("company_id", company)
      .eq("id", note.id).eq("revision", note.revision ?? -1).select("id").maybeSingle();
    lock.current = false;
    setWorking(false);
    if (error || !data) setError("No se pudo eliminar. La nota puede haber cambiado en otra sesión.");
    else {
      setNotes(rows => rows.filter(row => row.id !== note.id));
      if (selectedId === note.id) { setDraft(null); setBase(null); setView("groups"); }
    }
  }

  const groups = labels.filter(label => label.kind === "group").sort(compareNoteLabels);
  const statuses = labels.filter(label => label.kind === "status").sort(compareNoteLabels);
  const tags = labels.filter(label => label.kind === "tag").sort(compareNoteLabels);
  const labelIndex = useMemo(() => new Map(labels.map(label => [label.id, label])), [labels]);
  const getLabel = (id: string | null) => id ? labelIndex.get(id) : undefined;
  const nextPosition = notes.reduce((position, note) => Math.max(position, note.position), 0) + 1;
  const search = normalizeNoteText(query.trim());
  const filtered = notes.filter(note => {
    const noteGroup = note.group_id ?? UNASSIGNED;
    if (groupFilter && noteGroup !== groupFilter ||
        statusFilter && (note.status_id ?? UNASSIGNED) !== statusFilter || pinnedOnly && !note.pinned) return false;
    if (!tagFilters.every(id => markerIds(note).includes(id))) return false;
    return !search || normalizeNoteText([note.title, note.body, getLabel(note.group_id)?.name, getLabel(note.status_id)?.name,
      ...markerIds(note).map(id => getLabel(id)?.name)].join(" ")).includes(search);
  }).sort((a, b) => {
    const name = a.title.localeCompare(b.title, "es");
    const difference = order === "custom" ? byPosition(a, b) : order === "name" ? name : order === "nameDesc" ? -name
      : order === "created" ? (b.created_at ?? "").localeCompare(a.created_at ?? "")
      : (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    return Number(b.pinned) - Number(a.pinned) || difference || a.id.localeCompare(b.id);
  });

  const groupedNotes = new Map<string, Note[]>();
  for (const note of filtered) {
    const id = note.group_id ?? UNASSIGNED;
    const rows = groupedNotes.get(id);
    if (rows) rows.push(note);
    else groupedNotes.set(id, [note]);
  }

  function groupIsExpanded(id: string) {
    return groupExpansion[id] ?? (Boolean(query.trim()) && Boolean(groupedNotes.get(id)?.length));
  }

  function toggleGroup(id: string) {
    const expanded = groupIsExpanded(id);
    setGroupExpansion(items => ({ ...items, [id]: !expanded }));
    setMenu("");
  }

  async function reorder(note: Note, destination: Note) {
    if (pending || note.id === destination.id || note.pinned !== destination.pinned || note.group_id !== destination.group_id) return;
    const rows = notes.filter(row => row.group_id === note.group_id && row.pinned === note.pinned).sort(byPosition);
    const previous = rows.findIndex(row => row.id === note.id);
    const next = rows.findIndex(row => row.id === destination.id);
    if (previous < 0 || next < 0) return;
    rows.splice(previous, 1);
    rows.splice(next, 0, note);
    const items = rows.map((row, position) => ({ id: row.id, revision: row.revision, position: position + 1 }))
      .filter((item, index) => rows[index].position !== item.position);
    if (!items.length) return;
    lock.current = true;
    setWorking(true);
    try {
      const { error } = await supabase.rpc("order_workspace_notes", { c: company, items });
      if (error) throw error;
      if (draft && items.some(item => item.id === draft.id)) {
        setDraft(null);
        setBase(null);
      }
      await reload();
      setOrder("custom");
    } catch {
      setError("No se pudo cambiar el orden. Actualiza el listado e inténtalo de nuevo.");
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  async function reorderGroup(item: NoteLabel, destination: NoteLabel) {
    if (working || pending || !canManage || item.id === destination.id) return;
    const sorted = [...groups];
    const from = sorted.findIndex(group => group.id === item.id);
    const to = sorted.findIndex(group => group.id === destination.id);
    if (from < 0 || to < 0) return;
    sorted.splice(from, 1);
    sorted.splice(to, 0, item);
    const items = sorted.map((group, index) => ({ id: group.id, previous: group.position, position: index + 1 }))
      .filter(row => row.previous !== row.position);
    if (!items.length) return;
    setWorking(true);
    const { error } = await supabase.rpc("order_note_groups", { c: company, items });
    if (error) setError("No se pudo reordenar. Actualiza el listado e inténtalo de nuevo.");
    else setLabels(labels => labels.map(label => {
      const row = items.find(item => item.id === label.id);
      return row ? { ...label, position: row.position } : label;
    }));
    setWorking(false);
  }

  async function groupDelete(item: NoteLabel) {
    const { data, error } = await supabase.rpc("remove_note_group", { c: company, g: item.id, destination: null, expected_count: null });
    if (error) setError("No se pudo consultar el grupo.");
    else setDeletion({ item, count: Number(data) });
  }

  function noteActions(note: Note) {
    return <div className="note-actions-pop" role="group" aria-label="Acciones de la nota">
      {([["move","Mover a otro grupo"],["status","Cambiar estado"],["tags","Asignar marcadores"]] as const).map(([type, label]) =>
        <AppButton key={type} className="secondary" disabled={working} onClick={() => { setAction({ type, note }); setMenu(""); }}>{label}</AppButton>)}
      <AppButton className="secondary" iconKey="action.duplicate" disabled={pending || note.revision === null} onClick={async () => {
        setMenu("");
        const title = note.title.slice(0, 141) + " (copia)";
        await updateNote({ ...note, id: crypto.randomUUID(), revision: null }, { title, position: nextPosition, pinned: false });
      }}>Duplicar</AppButton>
      <AppButton className="secondary" disabled={working} onClick={() => { setMenu(""); void updateNote(note, { pinned: !note.pinned }); }}>
        {note.pinned ? "Desfijar" : "Fijar"}
      </AppButton>
      {[-1, 1].map(direction => {
        const siblings = notes.filter(row => row.group_id === note.group_id && row.pinned === note.pinned).sort(byPosition);
        const target = siblings[siblings.findIndex(row => row.id === note.id) + direction];
        return <AppButton key={direction} className="secondary" disabled={!target || pending} onClick={() => {
          setMenu(""); if (target) void reorder(note, target);
        }}>{direction < 0 ? "Subir en orden personalizado" : "Bajar en orden personalizado"}</AppButton>;
      })}
      {note.author_id === user && note.revision !== null && <AppButton className="secondary danger" iconKey="action.delete" disabled={pending} onClick={() => { setMenu(""); void removeNote(note); }}>Eliminar</AppButton>}
    </div>;
  }

  function noteLabels(note: Note, compact = false) {
    const status = getLabel(note.status_id);
    const items = tags.filter(tag => markerIds(note).includes(tag.id));
    return <div className="note-badges">
      {status && <NoteLabelBadge label={status} />}
      {items.slice(0, compact ? 2 : undefined).map(label => <NoteLabelBadge key={label.id} label={label} />)}
      {compact && items.length > 2 && <span className="note-badge" title={items.slice(2).map(label => label.name).join(", ")}>+{items.length - 2}</span>}
    </div>;
  }

  const renderedAction = action && <form className="note-panel note-action-form" ref={actionForm} key={action.note.id + action.type} onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const note = action.note.id === selectedId && dirty ? draft! : action.note;
    const value = String(data.get("value") ?? "");
    const patch = action.type === "move" ? { group_id: value || null }
      : action.type === "status" ? { status_id: value || null } : { note_markers: data.getAll("marker").map(id => ({ marker_id: String(id) })) };
    if (await updateNote(note, patch)) setAction(undefined);
  }}>
    <strong>{({ move: "Mover nota", status: "Cambiar estado", tags: "Asignar marcadores" })[action.type]} · {noteTitle(action.note)}</strong>
    {action.type === "move" && <><span>Grupo actual · {getLabel(action.note.group_id)?.name ?? "Sin clasificar"}</span>
      <SearchSelect name="value" aria-label="Grupo de destino" defaultValue={action.note.group_id ?? ""}>
        <option value="">Sin clasificar</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </SearchSelect></>}
    {action.type === "status" && <SearchSelect name="value" aria-label="Estado de la nota" defaultValue={action.note.status_id ?? ""}>
      <option value="">Sin estado</option>{statuses.filter(item => item.active || item.id === action.note.status_id)
        .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </SearchSelect>}
    {action.type === "tags" && <div className="note-marker-options">{tags.filter(item => item.active || markerIds(action.note).includes(item.id)).map(item =>
      <label key={item.id} className="note-check"><input type="checkbox" name="marker" value={item.id} defaultChecked={markerIds(action.note).includes(item.id)} />
        {item.name}{item.active ? "" : " (inactivo)"}</label>)}{!tags.length && <span>Configura marcadores en Configuración de notas.</span>}</div>}
    <div className="note-inline"><AppButton className="secondary" onClick={() => setAction(undefined)}>Cancelar</AppButton>
      <AppButton type="submit" disabled={working || uploading}>{action.type === "move" ? "Confirmar traslado" : "Aplicar"}</AppButton></div>
  </form>;

  function folderButton(id: string, title: string) {
    const expanded = groupIsExpanded(id);
    return <button type="button" className="note-group-choice" aria-expanded={expanded} onClick={() => toggleGroup(id)}>
      <AppIcon name={expanded ? "action.collapse" : "action.expand"} />
      {expanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
      <span>{title}</span>
    </button>;
  }

  function renderFolderNotes(id: string) {
    return <div className="note-group-notes">
        {(groupedNotes.get(id) ?? []).map(note => <article key={note.id} className="note-card" data-selected={selectedId === note.id} draggable={order === "custom" && !pending}
          onDragStart={() => { drag.current = note.id; }} onDragOver={event => { if (drag.current) event.preventDefault(); }}
          onDragEnd={() => { drag.current = ""; }} onDrop={event => {
            event.preventDefault(); const source = notes.find(row => row.id === drag.current); drag.current = "";
            if (source) void reorder(source, note);
          }}>
          <button className="note-open" onClick={() => void openNote(note)}>
            <strong>{note.pinned && <span title="Nota fijada">◆ </span>}{noteTitle(note)}</strong>
          </button>
          {noteLabels(note, true)}
          <div className="note-menu note-card-menu">
            <AppButton className="secondary note-icon" aria-label={"Acciones de " + noteTitle(note)} aria-expanded={menu === note.id}
              onClick={() => setMenu(menu === note.id ? "" : note.id)}>⋮</AppButton>
            {menu === note.id && noteActions(note)}
          </div>
        </article>)}
    </div>;
  }

  return <section className="production-notes" onKeyDown={event => { if (event.key === "Escape" && menu) setMenu(""); }}>
    {error && <p className="error" role="alert">{error}</p>}
    {renderedAction}
    <div className="note-layout" data-view={view}>
      <aside className="note-groups" aria-label="Carpetas de notas">
        <div className="note-header"><h1>Notas</h1>
          <AppButton className="secondary note-icon" iconKey="action.add" title="Nueva nota" aria-label="Nueva nota" disabled={loading || working} onClick={() => void newNote()} />
          <AppButton className="secondary note-icon" aria-label="Opciones de notas" aria-expanded={menu === "workspace"} onClick={() => setMenu(menu === "workspace" ? "" : "workspace")}>⋮</AppButton>
          {menu === "workspace" && <div className="note-actions-pop">
            <AppButton className="secondary" onClick={() => { setMenu(""); setGroupForm({}); setDeletion(undefined); }}>Nuevo grupo</AppButton>
            <AppButton className="secondary" disabled={pending || loading} onClick={async () => {
              setMenu("");
              try { await reload(); setError(""); } catch { setError("No se pudieron actualizar las notas."); }
            }}>Actualizar notas</AppButton>
          </div>}
        </div>
        {groupForm && <NoteLabelForm key={groupForm.item?.id ?? "new"} company={company} kind="group" item={groupForm.item}
          position={(groups.at(-1)?.position ?? 0) + 1} onClose={() => setGroupForm(undefined)}
          onSaved={item => {
            setLabels(items => [...items.filter(label => label.id !== item.id), item]);
            setGroupForm(undefined);
          }} />}
        {deletion && <form className="note-label-form" onSubmit={async event => {
          event.preventDefault();
          if (pending || lock.current) return;
          const value = String(new FormData(event.currentTarget).get("destination") ?? "");
          if (!await confirmAction("¿Eliminar el grupo «" + deletion.item.name + "» y trasladar sus notas?")) return;
          setWorking(true);
          const { error } = await supabase.rpc("remove_note_group", {
            c: company, g: deletion.item.id, destination: value || null, expected_count: deletion.count,
          });
          try {
            if (error) throw error;
            if (groupFilter === deletion.item.id) setGroupFilter("");
            setView("groups");
            setDraft(null); setBase(null);
            await reload();
            setDeletion(undefined);
          } catch { setError("No se pudo eliminar el grupo. Si cambió la cantidad de notas, vuelve a abrir esta acción."); }
          finally { setWorking(false); }
        }}>
          <strong>Eliminar {deletion.item.name} · {deletion.count} notas</strong>
          <SearchSelect name="destination" aria-label="Destino de las notas" defaultValue="">
            <option value="">Trasladar a Sin clasificar</option>
            {groups.filter(item => item.id !== deletion.item.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SearchSelect>
          <div className="note-inline"><AppButton className="secondary" onClick={() => setDeletion(undefined)}>Cancelar</AppButton>
            <AppButton className="danger" type="submit" disabled={pending}>Eliminar grupo</AppButton></div>
        </form>}
        <input type="search" placeholder="Buscar notas…" aria-label="Buscar notas" value={query} onChange={event => setQuery(event.target.value)} />
        <details className="note-filters">
          <summary>Filtros y orden</summary>
          <div className="note-inline">
            <SearchSelect aria-label="Filtrar por grupo" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}>
              <option value="">Cualquier grupo</option><option value={UNASSIGNED}>Sin clasificar</option>
              {groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </SearchSelect>
            <SearchSelect aria-label="Filtrar por estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="">Cualquier estado</option><option value={UNASSIGNED}>Sin estado</option>
              {statuses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </SearchSelect>
            <SearchSelect aria-label="Ordenar notas" value={order} onChange={event => setOrder(event.target.value)}>
              <option value="updated">Última modificación</option><option value="created">Fecha de creación</option>
              <option value="name">Nombre A–Z</option><option value="nameDesc">Nombre Z–A</option><option value="custom">Orden personalizado</option>
            </SearchSelect>
          </div>
          <label className="note-check"><input type="checkbox" checked={pinnedOnly} onChange={event => setPinnedOnly(event.target.checked)} /> Solo fijadas</label>
          <div className="note-marker-options">{tags.map(item => <label className="note-check" key={item.id}>
            <input type="checkbox" checked={tagFilters.includes(item.id)} onChange={event =>
              setTagFilters(items => event.target.checked ? [...items, item.id] : items.filter(id => id !== item.id))} />{item.name}
          </label>)}</div>
          <AppButton className="secondary" onClick={() => { setGroupFilter(""); setStatusFilter(""); setTagFilters([]); setPinnedOnly(false); setQuery(""); }}>Limpiar filtros</AppButton>
        </details>

        <div className="note-folder-scroll" role="region" aria-label="Lista de grupos y notas" tabIndex={0}>
        {loading ? <p role="status">Cargando notas…</p> : !filtered.length && <p role="status">No hay notas para esta selección.</p>}
        <div className="note-group">
          {folderButton(UNASSIGNED, "Sin clasificar")}
          {groupIsExpanded(UNASSIGNED) && renderFolderNotes(UNASSIGNED)}
        </div>
        {groups.map(item => {
          const expanded = groupIsExpanded(item.id);
          const editable = canManage || item.created_by === user;
          return <div className="note-group" key={item.id} draggable={canManage && !pending}
            onDragStart={event => { event.stopPropagation(); groupDrag.current = item.id; }}
            onDragOver={event => { if (groupDrag.current) event.preventDefault(); }}
            onDragEnd={() => { groupDrag.current = ""; }}
            onDrop={event => {
              if (!groupDrag.current) return;
              event.preventDefault();
              const source = groups.find(group => group.id === groupDrag.current);
              groupDrag.current = "";
              if (source) void reorderGroup(source, item);
            }}>
            <div className="note-group-row">
              {folderButton(item.id, item.name)}
              <div className="note-menu">
                <AppButton className="secondary note-icon" aria-label={"Acciones de " + item.name} aria-expanded={menu === item.id}
                  onClick={() => setMenu(menu === item.id ? "" : item.id)}>⋮</AppButton>
                {menu === item.id && <div className="note-actions-pop">
                  <AppButton className="secondary" iconKey="action.add" onClick={() => void newNote(item.id)}>Crear nota</AppButton>
                  {editable && <>
                    <AppButton className="secondary" iconKey="action.edit" onClick={() => { setGroupForm({ item }); setDeletion(undefined); setMenu(""); }}>Editar y ordenar</AppButton>
                    {canManage && [-1, 1].map(direction => {
                      const target = groups[groups.indexOf(item) + direction];
                      return <AppButton key={direction} className="secondary" disabled={pending || !target} onClick={() => {
                        setMenu(""); if (target) void reorderGroup(item, target);
                      }}>{direction < 0 ? "Subir grupo" : "Bajar grupo"}</AppButton>;
                    })}
                    <AppButton className="secondary danger" iconKey="action.delete" disabled={pending} onClick={() => { setMenu(""); setGroupForm(undefined); void groupDelete(item); }}>Eliminar grupo</AppButton>
                  </>}
                </div>}
              </div>
            </div>
            {expanded && renderFolderNotes(item.id)}
          </div>;
        })}
        </div>
      </aside>
      <article className="note-editor">
        {draft ? <>
          <div className="note-heading">
            <AppButton className="secondary note-icon note-mobile-nav" iconKey="action.back" aria-label="Volver a notas" disabled={uploading} onClick={() => setView("groups")} />
            <span className="note-save-state" role="status">
              {saveState === "saving" ? "Guardando…" : saveState === "conflict" ? "La nota cambió en otra sesión"
                : saveState === "error" ? "Error al guardar" : dirty ? "Cambios pendientes" : base?.revision != null ? "Cambios guardados" : ""}
            </span>
            {saveState === "error" && <AppButton className="secondary" onClick={() => void saveDraft()}>Reintentar</AppButton>}
            {saveState === "conflict" && <AppButton className="secondary" onClick={async () => {
              if (!await abandon()) return;
              const { data, error } = await supabase.from("production_notes").select(noteFields).eq("company_id", company).eq("id", draft.id).maybeSingle();
              if (error) setError("No se pudo recargar la nota.");
              else if (data) { setNotes(rows => [...rows.filter(row => row.id !== draft.id), data]); open(data); }
              else { setDraft(null); setBase(null); setNotes(rows => rows.filter(row => row.id !== draft.id)); setView("groups"); }
            }}>Cargar versión guardada</AppButton>}
            {base && <div className="note-menu"><AppButton className="secondary note-icon" aria-label="Acciones de la nota abierta"
              aria-expanded={menu === "editor"} onClick={() => setMenu(menu === "editor" ? "" : "editor")}>⋮</AppButton>
              {menu === "editor" && noteActions(draft)}</div>}
          </div>
          <input className="note-title" aria-label="Título de la nota" placeholder="Título" maxLength={150}
            value={draft.title} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} />
          {noteLabels(draft)}
          <NoteEditor key={editorKey} note={draft} company={company} user={user} onUploading={setUploading}
            onChange={(body, rich_body) => setDraft(current => current ? { ...current, body, rich_body } : current)} />
        </> : <p>Selecciona una nota o crea una nueva.</p>}
      </article>
    </div>
  </section>;
}
