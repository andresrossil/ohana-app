import { useEffect, useState, type FormEvent } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { supabase } from "./client";
import "./notes.css";

type Note = { id: string; title: string; body: string };
const blank: Note = { id: "", title: "", body: "" };

function notePreview(body: string) {
  const characters = Array.from(body.trim().replace(/\s+/gu, " "));
  if (!characters.length) return "Nota vacía";
  return characters.length > 100
    ? characters.slice(0, 100).join("") + "…"
    : characters.join("");
}

export default function Notes({ company, onDirty }: {
  company: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [original, setOriginal] = useState<Note | null>(null);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const dirty = original !== null && (original.title !== draft.title || original.body !== draft.body);
  useEffect(() => {
    onDirty(dirty || (original !== null && busy));
    return () => onDirty(false);
  }, [busy, dirty, onDirty, original]);
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("production_notes").select("id,title,body")
        .eq("company_id", company).order("updated_at", { ascending: false }).order("id");
      if (!active) return;
      if (error) setError("No se pudieron cargar las notas.");
      else setNotes(data);
      setBusy(false);
    }
    void load();
    return () => { active = false; };
  }, [company]);

  function open(note: Note) {
    setError("");
    setOriginal(note);
    setDraft(note);
  }

  async function back() {
    if (dirty && !await confirmAction("¿Salir de la nota sin guardar los cambios?")) return;
    setOriginal(null);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    const fields = { title: draft.title.trim(), body: draft.body };
    const table = supabase.from("production_notes");
    const query = draft.id
      ? table.update({ ...fields, updated_at: new Date().toISOString() }).eq("company_id", company).eq("id", draft.id)
      : table.insert({ ...fields, company_id: company });
    const { data, error } = await query.select("id,title,body").single();
    setBusy(false);
    if (error) {
      setError("No se pudo guardar la nota. Puedes volver a intentarlo.");
      return;
    }
    setNotes((previous) => [data, ...previous.filter((note) => note.id !== data.id)]);
    open(data);
  }

  async function remove(note: Note) {
    if (busy || !await confirmAction("¿Eliminar esta nota?")) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.from("production_notes").delete().eq("company_id", company)
      .eq("id", note.id).select("id").single();
    setBusy(false);
    if (error) setError("No se pudo eliminar la nota.");
    else setNotes((previous) => previous.filter(({ id }) => id !== note.id));
  }

  return <section className="production-notes">
    <header className="intro">
      <h1 className="module-title"><AppIcon name="module.notes" /> Notas</h1>
      {original
        ? <AppButton className="secondary" iconKey="action.back" disabled={busy} onClick={back}>Volver a notas</AppButton>
        : <AppButton iconKey="action.add" disabled={busy} onClick={() => open(blank)}>Nueva nota</AppButton>}
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {original ? <form className="catalog notes-page" onSubmit={save}>
      <input aria-label="Título de la nota" placeholder="Título" maxLength={150} autoFocus
        value={draft.title} readOnly={busy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <textarea aria-label="Texto de la nota" placeholder="Escribe aquí…" maxLength={100000}
        value={draft.body} readOnly={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
      <div className="actions"><AppButton type="submit" disabled={!dirty || busy}>Guardar nota</AppButton></div>
    </form> : notes.length > 0 ? <div className="notes-grid">
      {notes.map((note) => <article className="notes-card" key={note.id}>
        <button className="notes-open" type="button" onClick={() => open(note)}>
          <strong>{note.title || "Sin título"}</strong>
          <span>{notePreview(note.body)}</span>
        </button>
        <AppButton className="secondary notes-delete" iconKey="action.delete" disabled={busy}
          aria-label={"Eliminar " + (note.title || "nota sin título")} onClick={() => remove(note)} />
      </article>)}
    </div> : !error && <p role="status">{busy ? "Cargando notas…" : "Todavía no tienes notas."}</p>}
  </section>;
}
