# Ohana

Catálogo privado de materias primas, proveedores, presentaciones, enlaces de compra, unidades configurables y precios históricos. Diseño original Ohana, en español, adaptable a computadora y celular.

Incluye una [hoja editable con pegado desde Excel](docs/hoja-materias-primas.md), selección y copia de rangos, importación histórica y confirmación de lotes de hasta 500 filas. Se conserva la vista clásica del catálogo.

Repositorio principal: https://github.com/andresrossil/ohana-app

Aplicación: https://andresrossil.github.io/ohana-app/

## Tecnología

React 19, TypeScript 6 y Vite 8, el mismo enfoque del portafolio andresrossil.github.io. GitHub Pages aloja los archivos estáticos; Supabase mantiene autenticación, base de datos y permisos. No necesita servidor de Node en producción. Las dependencias están fijadas y el lockfile está incluido.

## Desarrollo

1. Ejecutar `npm ci`.
2. Copiar `.env.example` a `.env.local` y completar la clave **publicable** del proyecto existente.
3. Ejecutar `npm run dev` y abrir la URL que imprime Vite, incluyendo `/ohana-app/`.
4. Ejecutar `npm run build` antes de subir cambios a main.

No usar claves `service_role` ni `sb_secret_` en ninguna variable VITE. Todo valor VITE termina en el navegador; las variables no ocultan secretos. El frontend utiliza únicamente la URL y la clave publicable, mientras que RLS autoriza el acceso real a datos.

## Publicación

GitHub Actions compila cada cambio a main y publica solo `dist/` en Pages. Variables de repositorio en Settings → Secrets and variables → Actions → Variables:

- `VITE_SUPABASE_URL`: URL del proyecto existente.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: clave publicable del mismo proyecto.

Pages debe utilizar GitHub Actions como fuente. El workflow concede lectura de código al trabajo de compilación y permisos de Pages e identidad únicamente al trabajo de despliegue. La ruta base de Vite es `/ohana-app/`; la interfaz usa estado interno y el retorno de autenticación usa parámetros en la raíz, evitando rutas que den 404 en Pages.

## Supabase existente

Conservar el proyecto `fkkmhdwgldddoylnxnnh`. Publicar el frontend no crea tablas, no ejecuta migraciones y no modifica datos ni cuentas. Las cuentas existentes conservan correo y contraseña; la sesión deberá iniciarse otra vez al cambiar de dominio.

En Authentication → URL Configuration:

- Site URL: `https://andresrossil.github.io/ohana-app/`
- Redirect URL: `https://andresrossil.github.io/ohana-app/?auth=confirm`
- Durante desarrollo, autorizar explícitamente `http://localhost:5173/ohana-app/?auth=confirm` si se necesita probar registro local.

Mantener confirmación de correo habilitada. El frontend muestra “Cuenta verificada” solamente cuando Supabase devuelve una sesión con correo confirmado; un parámetro de URL por sí solo no confirma cuentas. Los enlaces expirados muestran una salida al acceso.

Los usuarios existentes no necesitan volver a registrarse. Los permisos están en company_members y no en metadatos editables del usuario. Admin/editor pueden editar, viewer solo consultar. El historial de precios es de solo inserción para clientes. Las relaciones compuestas impiden enlaces entre empresas y current_prices usa security_invoker.

## Migraciones y privacidad

Las migraciones son referencias versionadas del esquema ya aplicado. **No volver a ejecutarlas contra producción.** La migración de bootstrap se publica sin la inserción privada del correo administrador. La lista real y sus asignaciones permanecen en la base de datos; una instalación independiente debe aprovisionarlas administrativamente fuera del código.

El repositorio comienza con una instantánea limpia para no publicar datos privados del historial previo. El código y las funciones existentes se conservan; la copia original y su historial permanecen localmente como respaldo. No se incluyen exportaciones de datos, archivos de sesión, `.env.local` ni configuración de ChatGPT Sites.

La página de acceso y el código son públicos; los datos del negocio requieren autenticación y pertenencia a la empresa. No agregar datos del negocio a archivos dentro de public/.

## Comprobación

`npm run build` valida tipos y genera producción. `supabase/tests/catalog_rls.sql` contiene pruebas transaccionales con rollback para aislamiento, roles y precios; ejecutar solo en una sesión administrativa controlada. Los despliegues del frontend no ejecutan estas pruebas ni migraciones automáticamente.

Todas las futuras mejoras deben guardarse en este repositorio y publicarse a través del workflow de Pages.
