import { onIdleRefresh } from "./idle-refresh";
import { useEffect, useRef } from "react";
export function pricesChanged(company: string) {
  window.dispatchEvent(new CustomEvent("ohana-prices", { detail: company }));
  try {
    localStorage.setItem(
      "ohana.price-change",
      JSON.stringify({ company, time: Date.now() }),
    );
  } catch {}
}
export function usePriceRefresh(company: string, refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const local = (e: Event) => {
      if ((e as CustomEvent).detail === company) latest.current();
    };
    const external = (e: StorageEvent) => {
      if (e.key === "ohana.price-change") {
        try {
          if (JSON.parse(e.newValue || "{}").company === company)
            latest.current();
        } catch {}
      }
    };
    const cancelIdle = onIdleRefresh(() => latest.current());
    window.addEventListener("ohana-prices", local);
    window.addEventListener("storage", external);
    return () => {
      window.removeEventListener("ohana-prices", local);
      window.removeEventListener("storage", external);
      cancelIdle();
    };
  }, [company]);
}
