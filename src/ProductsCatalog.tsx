import ProductImage from "./ProductImage";
import VariantManager from "./VariantManager";
import { useState, useEffect } from "react";
import type { ComponentProps, FormEvent } from "react";
import { supabase as db } from "./client";
import type { CatalogRow } from "./sheet-model";
import CatalogFields from "./CatalogFields";
import CatalogFilters, { originMatches } from "./CatalogFilters";
import { identityPayload, matchesCatalog } from "./catalog-model";
export default function ProductsCatalog({
  company,
  products,
  origins,
  units,
  canWrite,
  onSaved,
  onBarcode,
  requestCodes,
}: {
  company: string;
  products: CatalogRow[];
  origins: CatalogRow[];
  units: CatalogRow[];
  canWrite: boolean;
  onSaved: () => Promise<void>;
  onBarcode: (item: CatalogRow) => void;
  requestCodes?: ComponentProps<typeof CatalogFields>["requestCodes"];
}) {
  const [variantIndex, setVariantIndex] = useState<CatalogRow[]>([]);
  useEffect(() => {
    let live = true;
    db.from("product_variants")
      .select("id,product_id,sku,barcode,name")
      .eq("company_id", company)
      .then((r) => {
        if (live) setVariantIndex(r.data || []);
      });
    return () => {
      live = false;
    };
  }, [company, products]);
  const [variantProduct, setVariantProduct] = useState<CatalogRow | null>(null);
  const [edit, setEdit] = useState<CatalogRow | null | undefined>(),
    [query, setQuery] = useState(""),
    [origin, setOrigin] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const filtered = products.filter(
    (p) =>
      (matchesCatalog(p, query) ||
        variantIndex.some(
          (v) => v.product_id === p.id && matchesCatalog(v, query),
        )) &&
      originMatches(p.origin_id, origin),
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      const { classification: _, ...metadata } = identityPayload(f);
      let photo = edit?.photo_path || null;
      const file = f.get("photo");
      let uploaded: string | null = null;
      if (f.has("remove_photo")) photo = null;
      if (file instanceof File && file.size) {
        if (
          file.size > 3145728 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type)
        )
          throw Error("La fotografía debe ser PNG, JPG o WebP de hasta 3 MB");
        const image = await createImageBitmap(file);
        image.close();
        uploaded =
          company +
          "/" +
          crypto.randomUUID() +
          ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[
            file.type
          ] || ".png");
        const r = await db.storage
          .from("catalog-images")
          .upload(uploaded, file);
        if (r.error) throw r.error;
        photo = uploaded;
      }
      const payload = {
        photo_path: photo,
        company_id: company,
        name: String(f.get("name")).trim(),
        notes: String(f.get("notes") || ""),
        description: String(f.get("description") || ""),
        published: f.get("published") === "on",
        unit_id: f.get("unit_id") || null,
        active: f.get("active") !== "false",
        ...metadata,
      };
      const result = edit
        ? await db
            .from("products")
            .update(payload)
            .eq("company_id", company)
            .eq("id", edit.id)
        : await db.from("products").insert(payload);
      if (result.error) {
        if (uploaded)
          await db.storage.from("catalog-images").remove([uploaded]);
        throw result.error;
      }
      setEdit(undefined);
      await onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">LO QUE CREAS</p>
          <h1>Productos</h1>
          <p>Tu catálogo de productos terminados.</p>
        </div>
        {canWrite && (
          <button
            onClick={() => {
              setError("");
              setEdit(null);
            }}
          >
            Agregar producto
          </button>
        )}
      </section>
      <section className="catalog">
        <div className="toolbar">
          <h2>
            Tu catálogo <small>{products.length}</small>
          </h2>
          <input
            aria-label="Buscar productos"
            placeholder="Nombre, SKU o código de barras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <CatalogFilters
          origin={origin}
          onOrigin={setOrigin}
          origins={origins}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th>Origen</th>
                <th>Código de barras</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.sku || "—"}</td>
                  <td>
                    <div className="catalog-photo">
                      <ProductImage path={p.photo_path} name={p.name} />
                    </div>
                    <strong>{p.name}</strong>
                    <small>{p.notes}</small>
                  </td>
                  <td>
                    {origins.find((o) => o.id === p.origin_id)?.name ||
                      "Pendiente"}
                  </td>
                  <td>{p.barcode || "—"}</td>
                  <td>
                    <span className={`status ${p.active ? "" : "inactive"}`}>
                      {p.active ? "Activo" : "Archivado"}
                    </span>
                  </td>
                  <td className="actions">
                    <button onClick={() => setVariantProduct(p)}>
                      Variantes y existencias
                    </button>
                    {canWrite && (
                      <button
                        onClick={() => {
                          setError("");
                          setEdit(p);
                        }}
                      >
                        Editar
                      </button>
                    )}
                    {p.barcode && (
                      <button onClick={() => onBarcode(p)}>
                        Código de barras
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="empty">
              {products.length
                ? "No hay resultados para estos filtros."
                : "Agrega tu primer producto para comenzar."}
            </p>
          )}
        </div>
      </section>
      {variantProduct && (
        <VariantManager
          company={company}
          product={variantProduct}
          onChanged={onSaved}
          onClose={() => setVariantProduct(null)}
        />
      )}
      {edit !== undefined && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Editar producto"
          >
            <button
              className="close"
              disabled={busy}
              aria-label="Cerrar producto"
              onClick={() => setEdit(undefined)}
            >
              ×
            </button>
            <h2>{edit ? "Editar producto" : "Nuevo producto"}</h2>
            <form onSubmit={save}>
              <label>
                Nombre
                <input
                  name="name"
                  maxLength={160}
                  required
                  defaultValue={edit?.name || ""}
                />
              </label>
              <CatalogFields
                company={company}
                kind="product"
                item={edit}
                origins={origins}
                requestCodes={requestCodes}
              />
              <label>
                Unidad de medida (opcional)
                <select name="unit_id" defaultValue={edit?.unit_id || ""}>
                  <option value="">Pendiente</option>
                  {units
                    .filter((u) => u.active || u.id === edit?.unit_id)
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Fotografía (PNG, JPG o WebP, hasta 3 MB)
                <input
                  name="photo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                />
              </label>
              {edit?.photo_path && (
                <label>
                  <input name="remove_photo" type="checkbox" /> Quitar
                  fotografía actual
                </label>
              )}
              <label>
                Descripción pública
                <textarea
                  name="description"
                  defaultValue={edit?.description || ""}
                />
              </label>
              <label>
                <input
                  name="published"
                  type="checkbox"
                  defaultChecked={edit?.published ?? false}
                />{" "}
                Publicar producto en tienda
              </label>
              <label>
                Notas
                <textarea name="notes" defaultValue={edit?.notes || ""} />
              </label>
              {edit && (
                <label>
                  Estado
                  <select name="active" defaultValue={String(edit.active)}>
                    <option value="true">Activo</option>
                    <option value="false">Archivado</option>
                  </select>
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button disabled={busy}>
                {busy ? "Guardando…" : "Guardar producto"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
