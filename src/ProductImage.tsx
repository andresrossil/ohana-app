import { useEffect, useState } from "react";
import { supabase as db } from "./client";
export default function ProductImage({
  path,
  name,
}: {
  path?: string | null;
  name: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    if (!path) return;
    const load = () => {
      db.storage
        .from("catalog-images")
        .createSignedUrl(path, 3600)
        .then((r) => {
          if (live) setUrl(r.data?.signedUrl || "");
        });
    };
    load();
    const timer = setInterval(load, 3000000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path]);
  return url ? (
    <img
      className="product-photo"
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setUrl("")}
    />
  ) : (
    <div
      className="product-photo photo-empty"
      aria-label={`Sin fotografía de ${name}`}
    >
      ✳
    </div>
  );
}
