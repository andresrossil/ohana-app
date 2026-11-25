import DOMPurify from "dompurify";
import { supabase } from "./client";

export type NoteLabel = {
  id: string; kind: "group" | "status" | "tag"; name: string; color: string;
  icon: string; position: number; active: boolean; created_by: string | null;
};
export type Note = {
  id: string; title: string; body: string; rich_body: string | null; group_id: string | null;
  status_id: string | null; pinned: boolean; position: number; revision: number | null;
  created_at: string | null; updated_at: string | null; note_markers: { marker_id: string }[];
};

export const noteFields = "id,title,body,rich_body,group_id,status_id,pinned,position,revision,created_at,updated_at,note_markers(marker_id)";
export const normalizeNoteText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
export const noteDate = (date: string | null) => date ? new Date(date).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "Fecha sin registrar";
export const markerIds = (note: Note) => note.note_markers.map(({ marker_id }) => marker_id);
export const compareNoteLabels = (a: NoteLabel, b: NoteLabel) => a.position - b.position || a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id);

export async function loadRows<T>(table: string, company: string, columns: string) {
  const rows: T[] = [];
  const pageSize = 500;
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).eq("company_id", company)
      .order("id").range(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    rows.push(...data as T[]);
    if (data.length < pageSize) return rows;
  }
}

export function embeddedNoteImages(html: string) {
  const images = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ["img"], ALLOWED_ATTR: ["src"], ALLOW_DATA_ATTR: false,
  });
  const files: File[] = [];
  for (const img of images.querySelectorAll("img")) {
    const match = (img.getAttribute("src") ?? "").match(/^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=]+)$/i);
    if (!match || match[2].length > 4 * 1024 * 1024) continue;
    try {
      const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
      const extension = match[1].toLowerCase();
      files.push(new File([bytes], "imagen." + extension, { type: "image/" + extension }));
    } catch {
      // Ignore malformed clipboard images.
    }
  }
  return files;
}

export function sanitizeNote(html: string, assetPrefix = "") {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ["a","b","strong","i","em","u","s","div","span","p","br","h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","pre","code",
      "table","thead","tbody","tfoot","tr","th","td","img"],
    ALLOWED_ATTR: ["href","alt","colspan","rowspan","data-note-image","data-check"],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  fragment.querySelectorAll("img").forEach((img) => {
    const path = img.getAttribute("data-note-image") ?? "";
    if (!assetPrefix || !path.startsWith(assetPrefix) || !/^[0-9a-f-]{36}\.(png|jpeg|webp|gif)$/.test(path.slice(assetPrefix.length))) img.remove();
  });
  fragment.querySelectorAll("a").forEach((link) => {
    if (!/^(https?:\/\/|mailto:)/i.test(link.getAttribute("href") ?? "")) link.removeAttribute("href");
    link.rel = "noopener noreferrer";
    link.target = "_blank";
  });
  fragment.querySelectorAll("[data-check]").forEach((item) => {
    if (item.tagName !== "LI" || !["yes", "no"].includes(item.getAttribute("data-check") ?? "")) item.removeAttribute("data-check");
  });
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}
