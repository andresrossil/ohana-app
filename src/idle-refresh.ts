export const IDLE_REFRESH_MS = 5 * 60 * 1000;
export function idleRefreshReady(
  now: number,
  activity: number,
  refresh: number,
  blocked: boolean,
  visible = true,
): boolean {
  return (
    !blocked &&
    visible &&
    now - activity >= IDLE_REFRESH_MS &&
    now - refresh >= IDLE_REFRESH_MS
  );
}
export function onIdleRefresh(refresh: () => unknown): () => void {
  const run = () => {
    void refresh();
  };
  window.addEventListener("ohana-idle-refresh", run);
  return () => window.removeEventListener("ohana-idle-refresh", run);
}
