import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { supabase } from "./client";
import { embeddedNoteImages, sanitizeNote, type Note } from "./noteWorkspace";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export default function NoteEditor({ note, company, user, onChange, onUploading }: {
  note: Note; company: string; user: string; onChange: (body: string, html: string) => void; onUploading: (uploading: boolean) => void;
}) {
  const companyPrefix = company + "/";
  const region = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const original = useRef(note);
  const mounted = useRef(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

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
    const safe = html && sanitizeNote(html, companyPrefix);
    if (safe) command("insertHTML", safe);
    if (region.current) void showImages(region.current);
    if (!safe && text) command("insertText", text);
    const files = Array.from(event.clipboardData.files);
    void upload(files.length ? files : embeddedNoteImages(html));
  }

  return <>
    {uploading && <span className="note-save-state" role="status">Subiendo imagen…</span>}
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
