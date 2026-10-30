# Materiales, productos e identificación

La actualización amplía el mismo catálogo y conserva los UUID, nombres, notas, unidades, presentaciones, URLs y precios existentes. No cambia sus descripciones ni asigna una clasificación, origen o SKU a los registros anteriores.

## Uso

- **Materiales** conserva el catálogo individual y la hoja de trabajo. Clasificación y origen se editan en la celda; SKU y código de barras aceptan texto o un valor vacío. Los datos de identificación pertenecen al material y se comparten entre sus presentaciones.
- **Copiar de Tabla** abre una carga vacía. Pegar N filas crea N filas automáticamente, hasta 500. Guardar abre una revisión y exige confirmación. Los datos opcionales pendientes advierten, pero no impiden guardar. Nombre, cantidad positiva y unidad configurada siguen siendo los únicos campos obligatorios de esta hoja.
- La clasificación ofrece Materia prima, Material de empaque o pendiente. Los filtros permiten consultar todas, una clasificación o pendientes. El cambio de clasificación conserva un SKU existente.
- **Productos** administra el catálogo de productos terminados: nombre, unidad opcional, notas, origen, SKU, código de barras y estado. Registrar un producto no registra compras, producción ni existencias.
- **Configuración** contiene Orígenes, Proveedores, Presentaciones y Unidades. Los orígenes iniciales se crean en la base de datos por empresa. Puedes crear, renombrar, desactivar o reactivar opciones. Las referencias a opciones inactivas siguen visibles; se impide eliminar una opción utilizada.
- **Inventario** ofrece una consulta del catálogo por clasificación y origen. Todavía no registra movimientos ni calcula existencias. **Reportes** permite consultar y descargar este catálogo filtrado como TSV para Excel.
- Compras, Fórmulas, Producción, Ventas y Clientes figuran como módulos pendientes. La barra lateral permanece en escritorio y se pliega en celular.

## SKU y código de barras

Las sugerencias nuevas utilizan M0001 (materia prima), E0001 (empaque) o P0001 (producto). Cada empresa y prefijo tiene un contador independiente y persistente. Reservar una sugerencia consume un número aunque se cancele: puede haber saltos. Los códigos manuales con ese formato también adelantan el contador para evitar sugerirlos después de eliminarlos. Se omiten los códigos ocupados. La clasificación pendiente no recibe un prefijo arbitrario. Un registro anterior puede seguir sin SKU; el formulario individual permite solicitar una sugerencia.

SKU y código de barras son opcionales. Un registro nuevo propone el mismo código de barras que el SKU, si es compatible con Code 128. Un código personalizado, incluso uno borrado explícitamente, se conserva al cambiar el SKU. El formulario permite volver a vincularlo mediante “Usar el SKU como código de barras”. Los códigos se guardan como texto para conservar ceros iniciales. La búsqueda reconoce nombre, nombre alternativo, SKU y código de barras.

La base protege la unicidad por negocio **entre ambos catálogos**, también ante escrituras concurrentes. Para evitar identificadores visualmente duplicados, compara sin diferencias de mayúsculas, espacios iniciales/finales o espacios repetidos. Los UUID siguen siendo las claves internas.

La acción **Código de barras** (o ▥ en la hoja) abre una vista Code 128 con texto debajo. Permite descargar PNG e imprimir entre 1 y 100 etiquetas. Las barras se generan localmente con JsBarcode; no se envían los códigos a un generador externo. Son identificadores internos, no EAN/UPC comerciales. Code 128 admite letras sin acentos, números y signos ASCII; se puede utilizar un código distinto de un SKU que contenga otros caracteres. Las etiquetas respetan márgenes blancos y mantienen negro sobre blanco.

La impresión utiliza la ventana de impresión del navegador y el tamaño natural del código; configurar allí papel, escala y destino. No se implementa una plantilla específica de impresora térmica. Revisar una etiqueta de prueba con la impresora y lector utilizados antes de imprimir un lote. Generar, descargar o imprimir etiquetas no genera movimientos de inventario.

## Excel y comparación de precios

El orden nuevo es SKU, CLASIFICACIÓN, ORIGEN, PROVEEDOR, OTRO NOMBRE, MATERIAL, CAPACIDAD, PRESENTACION, UNIDAD MEDIDA, COMENTARIO, PRECIO PRESENTACION, PRECIO UN, VS, PRECIO ANTERIOR, PROVEEDOR ANTERIOR, FECHA CONSULTA, CÓDIGO DE BARRAS.

“Copiar tabla” exporta encabezados y las 17 columnas. Se reconocen encabezados anteriores con MP y encabezados actuales con MATERIAL, incluso si se reordenan o incluyen un subconjunto. Las columnas omitidas conservan la identificación existente. También se reconoce la tabla anterior de 13 columnas sin encabezados al pegar en la primera celda; para rangos parciales o ambiguos, incluir encabezados evita interpretar un formato distinto. Los campos calculados pegados se ignoran.

VS muestra una marca verde cuando el precio por unidad comparable es menor, una cruz roja cuando es mayor y un indicador neutro si es igual o no hay información comparable. El texto accesible y la ayuda indican el resultado y la diferencia. Se mantienen las reglas de unidad, moneda, fecha e historial: no se compara un antecedente cuya unidad o fecha no se conoce.

## Seguridad y comprobaciones

La migración `materials_products_identity` es aditiva y ya está aplicada al proyecto existente. No volver a ejecutar las migraciones históricas en producción. Las tablas nuevas utilizan RLS y las relaciones incluyen la empresa. Los clientes no pueden modificar el registro compartido de códigos ni reiniciar contadores. Las funciones privilegiadas están en un esquema privado, con permisos limitados, búsqueda fija y comprobación explícita de usuario y pertenencia a la empresa.

La carga masiva sigue siendo una transacción completa e idempotente. Los clientes anteriores que omiten los campos nuevos siguen funcionando y no borran identificación. Un conflicto entre códigos, orígenes o presentaciones del mismo material cancela todo el lote. Cambiar solo identificación no añade precios ficticios al historial.

`npm test` cubre TSV antiguo y nuevo, cálculos, campos opcionales, identificación y generación Code 128. `supabase/tests/catalog_identity.sql` añade pruebas con rollback de unicidad cruzada, secuencias, códigos personalizados/vacíos, orígenes, compatibilidad, atomicidad, aislamiento, viewer y acceso anónimo. Las otras pruebas SQL siguen aplicándose.

La revisión de navegador usa únicamente datos sintéticos en `qa/catalog.html`, que no forma parte de la compilación de producción. Se comprobó el pegado de 30 filas, las sugerencias M/E compartidas entre presentaciones, importación parcial sin borrado de identificación, edición de SKU con código personalizado, descarga PNG, la vista de etiquetas, el menú de 390 px y el formulario de Productos. Las escrituras se verifican con pruebas SQL transaccionales; el fixture no debe confirmar guardados reales.
