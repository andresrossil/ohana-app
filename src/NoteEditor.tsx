import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { AppButton } from "./AppIcon";
import { supabase } from "./client";
import { embeddedNoteImages, sanitizeNote, type Note } from "./noteWorkspace";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const tools = [
  ["Negrita","B","bold"],["Cursiva","I","italic"],["Subrayar","U","underline"],
  ["Título","H2","formatBlock","h2"],["Subtítulo","H3","formatBlock","h3"],
  ["Viñetas","•","insertUnorderedList"],["Numeración","1.","insertOrderedList"],
  ["Deshacer","↶","undo"],["Rehacer","↷","redo"],
];

export default function NoteEditor({ note, company, user, onChange, onUploading }: {
  note: Note; company: string; user: string; onChange: (body: string, html: string) => void; onUploading: (uploading: boolean) => void;
}) {
  const companyPrefix = company + "/";
  const region = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection = useRef<Range | null>(null);
  const original = useRef(note);
  const mounted = useRef(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [table, setTable] = useState(false);

  async function showImages(area: HTMLElement) {
    const images = Array.from(area.querySelectorAll<HTMLImageElement>("img[data-note-image]:not([src])"));
    if (!images.length) return;
    const paths = [...new Set(images.map((img) => img.dataset.noteImage!))];
    const { data } = await supabase.storage.from("note-images").createSignedUrls(paths, 3600);
    if (!mounted.current) return;
    for (const img of images) {
      const url = data?.find((entry) => entry.path === img.dataset.noteImage)?.signedUrl;
      if (url) img.src = url;
    }
  }

  useEffect(() => {
    const area = region.current;
    if (!area) return;
    mounted.current = true;
    if (original.current.rich_body === null) area.textContent = original.current.body;
    else area.innerHTML = sanitizeNote(original.current.rich_body, companyPrefix);
    void showImages(area);
    return () => { mounted.current = false; };
  }, [companyPrefix]);

  function report() {
    if (!region.current) return;
    const body = region.current.innerText;
    const html = sanitizeNote(region.current.innerHTML, companyPrefix);
    onChange(body, html);
  }
  function remember() {
    const current = window.getSelection();
    if (current?.rangeCount && region.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  }
  function command(name: string, value?: string) {
    const area = region.current;
    if (!area) return;
    area.focus();
    if (selection.current && area.contains(selection.current.commonAncestorContainer)) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
    document.execCommand(name, false, value);
    remember();
    report();
  }

  async function upload(files: File[]) {
    if (uploading || !files.length) return;
    setUploading(true);
    onUploading(true);
    setError("");
    try {
      for (const file of files) {
        if (!imageTypes.has(file.type) || file.size > 3145728) throw new Error("Selecciona una imagen PNG, JPG, WebP o GIF de hasta 3 MB.");
        const path = companyPrefix + user + "/" + crypto.randomUUID() + "." + file.type.split("/")[1];
        const { error } = await supabase.storage.from("note-images").upload(path, file, { contentType: file.type });
        if (error) throw new Error("No se pudo subir la imagen. Inténtalo de nuevo.");
        if (!mounted.current) return;
        command("insertHTML", '<img data-note-image="' + path + '" alt="Imagen de la nota"><br>');
        if (region.current) void showImages(region.current);
      }
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) {
        setUploading(false);
        onUploading(false);
      }
    }
  }

  function paste(event: ClipboardEvent) {
    event.preventDefault();
    remember();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const safe = html && sanitizeNote(html);
    if (safe) command("insertHTML", safe);
    else if (text) command("insertText", text);
    const files = Array.from(event.clipboardData.files);
    void upload(files.length ? files : embeddedNoteImages(html));
  }

  return <>
    <div className="note-tools" role="group" aria-label="Formato de la nota">
      {tools.map(([label, symbol, action, value]) => <AppButton key={label} className="secondary" title={label} aria-label={label}
        onMouseDown={event => event.preventDefault()} onClick={() => command(action, value)}>{symbol}</AppButton>)}
      <AppButton className="secondary" title="Lista de verificación. Usa Alt + Espacio para marcar una tarea." onMouseDown={event => event.preventDefault()}
        onClick={() => command("insertHTML", '<ul><li data-check="no">Tarea</li></ul><p><br></p>')}>☐ Lista</AppButton>
      <AppButton className="secondary" onMouseDown={event => event.preventDefault()} onClick={() => { remember(); setTable(!table); setLink(null); }}>Tabla</AppButton>
      <AppButton className="secondary" onMouseDown={event => event.preventDefault()} onClick={() => { remember(); setLink(link === null ? "" : null); setTable(false); }}>Enlace</AppButton>
      <AppButton className="secondary" iconKey="action.upload" disabled={uploading} onMouseDown={event => event.preventDefault()}
        onClick={() => { remember(); fileInput.current?.click(); }}>{uploading ? "Subiendo…" : "Imagen"}</AppButton>
      <input ref={fileInput} hidden type="file" accept={[...imageTypes].join(",")} multiple onChange={event => {
        void upload(Array.from(event.target.files ?? [])); event.target.value = "";
      }} />
    </div>
    {link !== null && <form className="note-inline" onSubmit={event => {
      event.preventDefault();
      if (!/^(https?:\/\/|mailto:)/i.test(link.trim())) { setError("Usa un enlace https://, http:// o mailto:."); return; }
      const anchor = document.createElement("a");
      anchor.href = link.trim();
      anchor.textContent = selection.current?.toString() || link.trim();
      command("insertHTML", sanitizeNote(anchor.outerHTML));
      setLink(null); setError("");
    }}><input aria-label="Dirección del enlace" value={link} onChange={event => setLink(event.target.value)} />
      <AppButton type="submit">Insertar enlace</AppButton></form>}
    {table && <form className="note-inline" onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const rows = Math.max(1, Math.min(20, Number(fields.get("rows"))));
      const columns = Math.max(1, Math.min(12, Number(fields.get("columns"))));
      command("insertHTML", "<table><thead><tr>" + "<th>Encabezado</th>".repeat(columns) + "</tr></thead><tbody>" +
        ("<tr>" + "<td>&nbsp;</td>".repeat(columns) + "</tr>").repeat(rows) + "</tbody></table><p><br></p>");
      setTable(false);
    }}><label>Filas<input type="number" name="rows" min="1" max="20" defaultValue="2" required /></label>
      <label>Columnas<input type="number" name="columns" min="1" max="12" defaultValue="2" required /></label>
      <AppButton type="submit">Insertar tabla</AppButton></form>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="note-rich" ref={region} contentEditable suppressContentEditableWarning role="textbox"
      aria-label="Contenido de la nota" aria-multiline="true" onInput={() => { remember(); report(); }}
      onPointerUp={remember} onKeyUp={remember} onBlur={remember} onPaste={paste}
      onDrop={event => { event.preventDefault(); remember(); void upload(Array.from(event.dataTransfer.files)); }}
      onClick={event => {
        const item = (event.target as HTMLElement).closest<HTMLElement>("li[data-check]");
        if (item && event.clientX < item.getBoundingClientRect().left + 24) {
          item.dataset.check = item.dataset.check === "yes" ? "no" : "yes";
          report();
        }
      }}
      onKeyDown={event => {
        if (event.key !== " " || !event.altKey) return;
        const node = window.getSelection()?.anchorNode;
        const item = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("li[data-check]");
        if (item) { event.preventDefault(); item.dataset.check = item.dataset.check === "yes" ? "no" : "yes"; report(); }
      }} />
  </>;
}
