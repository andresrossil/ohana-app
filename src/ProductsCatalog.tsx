import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import { SearchField } from "./PoolControls";
import CatalogBadge from "./CatalogBadge";
import { AppButton, AppIcon } from "./AppIcon";
import { orderedProducts } from "./product-view";
import ProductImage from "./ProductImage";
import VariantManager from "./VariantManager";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import ProductCreateForm from "./ProductCreateForm";
import ProductActions from "./ProductActions";
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
  const saving = useRef(false);
  const createPosition = useRef<{ trigger: HTMLButtonElement; top: number } | null>(null);
  useLayoutEffect(() => {
    if (edit !== undefined || !createPosition.current) return;
    const { trigger, top } = createPosition.current;
    createPosition.current = null;
    trigger.focus({ preventScroll: true });
    if (window.scrollY !== top) window.scrollTo({ top, behavior: "instant" });
  }, [edit]);
  const [sort, setSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "created_at", direction: "asc" });
  useEffect(
    () => setSort({ column: "created_at", direction: "asc" }),
    [company],
  );
  function sortHeader(column: string, label: string) {
    return (
      <th
        aria-sort={
          sort.column === column
            ? sort.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button
          className="catalog-sort"
          type="button"
          onClick={() =>
            setSort((old) => ({
              column,
              direction:
                old.column === column && old.direction === "asc"
                  ? "desc"
                  : "asc",
            }))
          }
        >
          <AppIcon name="control.sort" />
          {label}{" "}
          {sort.column === column
            ? sort.direction === "asc"
              ? " · Asc."
              : " · Desc."
            : ""}
        </button>
      </th>
    );
  }
  const filtered = orderedProducts(
    products.filter(
      (p) =>
        (matchesCatalog(p, query) ||
          variantIndex.some(
            (v) => v.product_id === p.id && matchesCatalog(v, query),
          )) &&
        originMatches(p.origin_id, origin),
    ),
    sort.column,
    sort.direction,
    origins as { id: string; name: string }[],
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || saving.current) return;
    saving.current = true;
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
        is_intermediate: f.get("is_intermediate") === "on",
        available_for_sale: f.get("available_for_sale") === "on",
        minimum_stock: Number(f.get("minimum_stock") || 0),
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
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="products-home">
      <section className="products-heading dashboard-welcome">
        <div>
          <span>Lo que creas</span>
          <h1 className="module-title">
            <AppIcon name="module.products" />
            Productos
          </h1>
          <p>Tu catálogo de productos terminados.</p>
        </div>
        {canWrite && (
          <AppButton
            type="button" iconKey="action.add"
            onClick={event => {
              createPosition.current = { trigger: event.currentTarget, top: window.scrollY };
              setError("");
              setEdit(null);
            }}
          >
            Nuevo
          </AppButton>
        )}
      </section>
      <section className="dashboard-surface products-catalog">
        <div className="products-toolbar">
          <h2 className="dashboard-section-heading">
            Tu catálogo <small>{products.length}</small>
          </h2>
          <SearchField
            aria-label="Buscar productos"
            placeholder="Nombre, SKU o código de barras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <CatalogFilters origin={origin} onOrigin={setOrigin} origins={origins} wrapSelection />
        </div>
        <div className="table-wrap">
          <ResponsiveTable className="products-table" compactRowActions>
            <thead>
              <tr>
                {sortHeader("name", "Producto")}
                {sortHeader("sku", "SKU")}
                {sortHeader("origin", "Origen")}
                {sortHeader("barcode", "Código de barras")}
                {sortHeader("active", "Estado")}
                {sortHeader("created_at", "Fecha de creación")}
                <th>Variantes y existencias</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="product-identity">
                    <div className="product-identity-content">
                      <div className="product-thumb"><ProductImage path={p.photo_path} name={p.name} /></div>
                      <div>
                        <strong className="admin-name">{p.name}</strong>
                        <div className="product-mobile-identity"><small>{p.sku || "—"}</small> <CatalogBadge active={p.active} /></div>
                      </div>
                    </div>
                    {p.notes && <small className="product-row-notes">{p.notes}</small>}
                  </td>
                  <td className="product-desktop-identity">{p.sku || "—"}</td>
                  <td>
                    <CatalogBadge
                      origin={
                        origins.find((o) => o.id === p.origin_id)?.name ||
                        "Pendiente"
                      }
                    />
                  </td>
                  <td>{p.barcode || "—"}</td>
                  <td className="product-desktop-identity"><CatalogBadge active={p.active} /></td>
                  <td>
                    {p.created_at && Number.isFinite(Date.parse(p.created_at))
                      ? new Date(p.created_at).toLocaleString("es-GT")
                      : "—"}
                  </td>
                  <td data-mobile-visible className="product-variants-action">
                    <AppButton type="button" className="secondary" iconKey="module.inventory" onClick={() => setVariantProduct(p)}>
                      Variantes y existencias
                    </AppButton>
                  </td>
                  <td className="actions product-row-actions">
                    {(canWrite || p.barcode) && <ProductActions name={p.name}
                      onEdit={canWrite ? () => { setError(""); setEdit(p); } : undefined}
                      onBarcode={p.barcode ? () => onBarcode(p) : undefined} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
          {!filtered.length && (
            <p className="empty">
              {products.length
                ? "No hay resultados para estos filtros."
                : "Agrega tu primer producto para comenzar."}
            </p>
          )}
        </div>
      </section>
      </div>
      {variantProduct && (
        <VariantManager
          company={company}
          product={variantProduct}
          onChanged={onSaved}
          onClose={() => setVariantProduct(null)}
        />
      )}
      {edit === null && canWrite && <ProductCreateForm company={company} origins={origins} units={units}
        requestCodes={requestCodes} busy={busy} error={error} onSave={save} onClose={() => setEdit(undefined)} />}
      {edit && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Editar producto"
          >
            <AppButton
              className="close"
              disabled={busy}
              aria-label="Cerrar producto"
              onClick={() => setEdit(undefined)}
            >
              ×
            </AppButton>
            <h2>Editar producto</h2>
            <form onSubmit={save} aria-busy={busy}>
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
                <SearchSelect name="unit_id" defaultValue={edit?.unit_id || ""}>
                  <option value="">Pendiente</option>
                  {units
                    .filter((u) => u.active || u.id === edit?.unit_id)
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.name}
                      </option>
                    ))}
                </SearchSelect>
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
                Stock mínimo del producto
                <input name="minimum_stock" type="number" min="0" step="any" required defaultValue={edit?.minimum_stock ?? 0} />
                <small>Se compara con la suma disponible de sus variantes. Cero desactiva la sugerencia.</small>
              </label>
              <label className="check">
                <input name="is_intermediate" type="checkbox" defaultChecked={edit?.is_intermediate ?? false} />
                Producto intermedio
              </label>
              <label className="check">
                <input name="available_for_sale" type="checkbox" defaultChecked={edit?.available_for_sale ?? true} />
                Disponible para venta
              </label>
              <label>
                Notas
                <textarea name="notes" defaultValue={edit?.notes || ""} />
              </label>
              {edit && (
                <label>
                  Estado
                  <SearchSelect name="active" defaultValue={String(edit.active)}>
                    <option value="true">Activo</option>
                    <option value="false">Archivado</option>
                  </SearchSelect>
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  <AppIcon name="status.error" />
                  {error}
                </p>
              )}
              <AppButton disabled={busy}>
                {busy ? "Guardando…" : "Guardar producto"}
              </AppButton>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
