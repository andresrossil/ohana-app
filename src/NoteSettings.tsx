import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import { supabase } from "./client";
import { compareNoteLabels, loadRows, type NoteLabel } from "./noteWorkspace";
import "./notes.css";

const icons = [
  ["archive","Archivo"],["book-open","Libreta"],["circle-check","Completado"],["clock","Reloj"],
  ["flask-conical","Prueba"],["folder","Carpeta"],["lightbulb","Idea"],["pin","Fijado"],
  ["search","Investigación"],["star","Estrella"],["tag","Etiqueta"],["triangle-alert","Alerta"],
];

export function NoteLabelBadge({ label }: { label: NoteLabel }) {
  return <span className="note-badge" style={label.color ? { borderInlineStart: "4px solid " + label.color } : undefined}>
    {label.icon && <AppIcon name="module.notes" override={label.icon} />}{label.name}
  </span>;
}

export function NoteLabelForm({ company, kind, item, position, onSaved, onClose }: {
  company: string; kind: NoteLabel["kind"]; item?: NoteLabel; position: number;
  onSaved: (label: NoteLabel) => void; onClose: () => void;
}) {
  const [color, setColor] = useState(item?.color ?? "");
  const [icon, setIcon] = useState(item?.icon ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <form className="note-label-form" onSubmit={async event => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const fields = { name: String(form.get("name")).trim(), color, icon, position: Number(form.get("position")),
      active: kind === "group" || form.get("active") === "on" };
    if (!fields.name) { setError("Escribe un nombre."); return; }
    setSaving(true);
    const table = supabase.from("note_catalog");
    const query = item ? table.update(fields).eq("company_id", company).eq("id", item.id)
      : table.insert({ ...fields, company_id: company, kind });
    const result = await query.select().single();
    setSaving(false);
    if (result.error) setError("No se pudo guardar. Revisa los datos y vuelve a intentarlo.");
    else onSaved(result.data);
  }}>
    <label>Nombre<input name="name" defaultValue={item?.name} required maxLength={100} /></label>
    <label>Orden<input name="position" type="number" step="1" defaultValue={item?.position ?? position} required /></label>
    <label>Icono<SearchSelect value={icon} onChange={event => setIcon(event.target.value)}>
      <option value="">Sin icono</option>
      {icons.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </SearchSelect></label>
    <div className="note-inline">
      <label>Color<input type="color" value={color || "#808080"} onChange={event => setColor(event.target.value)} /></label>
      {color && <AppButton className="secondary" onClick={() => setColor("")}>Usar tema</AppButton>}
    </div>
    {kind !== "group" && <label className="note-check"><input name="active" type="checkbox" defaultChecked={item?.active ?? true} /> Activo</label>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="note-inline">
      <AppButton className="secondary" onClick={onClose} disabled={saving}>Cancelar</AppButton>
      <AppButton type="submit" iconKey="action.save" disabled={saving}>Guardar</AppButton>
    </div>
  </form>;
}

export default function NoteSettings({ company, onDirty }: { company: string; onDirty: (value: boolean) => void }) {
  const [labels, setLabels] = useState<NoteLabel[]>([]);
  const [editing, setEditing] = useState<{ kind: "status" | "tag"; item?: NoteLabel }>();
  const [message, setMessage] = useState("Cargando configuración…");
  useEffect(() => {
    let active = true;
    void loadRows<NoteLabel>("note_catalog", company, "*").then(rows => {
      if (active) { setLabels(rows); setMessage(""); }
    }).catch(() => { if (active) setMessage("No se pudo cargar la configuración de notas."); });
    return () => { active = false; };
  }, [company]);
  useEffect(() => { onDirty(!!editing); return () => onDirty(false); }, [editing, onDirty]);
  return <section className="note-settings">
    <h2>Configuración de notas</h2>
    <p>Los registros inactivos conservan las asociaciones de las notas existentes.</p>
    {message && <p role="status">{message}</p>}
    {(["status", "tag"] as const).map(kind => {
      const items = labels.filter(label => label.kind === kind).sort(compareNoteLabels);
      const title = kind === "status" ? "Estados" : "Marcadores";
      return <section key={kind} className="note-panel">
        <div className="note-inline"><h3>{title}</h3><AppButton iconKey="action.add" disabled={!!editing || !!message}
          onClick={() => setEditing({ kind })}>Agregar</AppButton></div>
        {items.map(item => <div key={item.id} className="note-setting-row">
          <NoteLabelBadge label={item} /><span>{item.active ? "Activo" : "Inactivo"} · Orden {item.position}</span>
          <AppButton className="secondary" iconKey="action.edit" title={"Editar " + item.name} aria-label={"Editar " + item.name}
            disabled={!!editing} onClick={() => setEditing({ kind, item })} />
        </div>)}
        {editing?.kind === kind && <NoteLabelForm key={editing.item?.id ?? kind} company={company} kind={kind} item={editing.item}
          position={(items.at(-1)?.position ?? 0) + 1} onClose={() => setEditing(undefined)}
          onSaved={label => { setLabels(rows => [...rows.filter(row => row.id !== label.id), label]); setEditing(undefined); }} />}
      </section>;
    })}
  </section>;
}
