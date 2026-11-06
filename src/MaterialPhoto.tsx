import { useEffect, useState } from "react";
import ProductImage from "./ProductImage";
import { supabase as db } from "./client";

export async function uploadMaterialPhoto(file: File, company: string) {
  if (file.size > 3145728 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("La imagen debe ser PNG, JPG o WebP de hasta 3 MB");
  const image = await createImageBitmap(file);
  image.close();
  const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
  const path = `${company}/materials/${crypto.randomUUID()}.${extension}`;
  const result = await db.storage.from("catalog-images").upload(path, file);
  if (result.error) throw result.error;
  return path;
}

export default function MaterialPhoto({ path, name = "material" }: { path?: string | null; name?: string }) {
  const [preview, setPreview] = useState("");
  const [removed, setRemoved] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <fieldset className="form-wide material-photo-field">
    <legend>Imagen del material</legend>
    <div className="material-photo-controls">
      {preview ? <img className="product-photo" src={preview} alt="Vista previa del material" /> : path && !removed ? <ProductImage path={path} name={name} /> : null}
      <label> Cargar o reemplazar imagen
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
          const file = e.target.files?.[0];
          setPreview(file ? URL.createObjectURL(file) : "");
        }} />
        <small>PNG, JPG o WebP · máximo 3 MB. Se guarda junto con el material.</small>
      </label>
    </div>
    {path && <label><input name="remove_photo" type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} /> Quitar imagen actual</label>}
  </fieldset>;
}
