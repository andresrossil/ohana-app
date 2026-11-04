# Ohana

The primary repository is https://github.com/andresrossil/ohana-app. Commit all future changes here. Deploy the React/Vite frontend through the GitHub Pages workflow. Do not publish subsequent changes only through ChatGPT Sites.

Preserve the existing design, logo, Spanish UI and catalog MVP. Keep the existing Supabase project fkkmhdwgldddoylnxnnh. Never create another database or reset the existing one as part of frontend deployment.

Never commit credentials, user data, account emails or database exports. VITE variables are public browser configuration, never secrets. Do not run historical migrations against the existing production database. Review RLS for schema changes. Build with npm run build before pushing.

All existing and future administrative tables must allow ascending and descending sorting on every column, on desktop and mobile. Reuse ResponsiveTable (automatic sorting and mobile controls) instead of introducing standalone tables. Preserve existing explicit sorting in MaterialSheet and other catalogs. Use data-sort-value for numeric, date or composite cells when the visible primary value is ambiguous. Sorting must be stable, keep unknown values distinct from zero, preserve row identity and pending edits, and never write to Supabase. Bulk-paste tables must connect onSortRows so paste follows the displayed row order. Keep the existing default order until the user chooses a column.
