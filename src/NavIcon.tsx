const paths: Record<string, string> = {
  dashboard: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  materials: "m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  products: "M4 7h16v14H4ZM8 7V4h8v3M8 12h8",
  purchases: "M3 3h3l2 13h11l2-9H7M10 21h.01M18 21h.01",
  formulas: "M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8",
  production: "M3 21V9l6 3V8l6 4V4h5v17ZM8 17h1m4 0h1m4 0h1",
  inventory: "M3 8 12 3l9 5v12H3ZM3 8l9 5 9-5M12 13v7",
  sales: "M4 20V10m6 10V5m6 15v-8m5-9-6 5-5-3-6 4",
  customers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-4",
  reports: "M4 3h12l4 4v14H4ZM14 3v6h6M8 17v-3m4 3v-5m4 5v-2",
  settings: "M4 7h16M4 17h16M9 4v6m6 4v6",
};
export default function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
}
