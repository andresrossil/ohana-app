# Hoja de materias primas

La hoja conserva las 13 columnas del Excel, en el mismo orden. Una fila representa una presentación cotizada, enlazada a materia prima, proveedor y unidad. El catálogo es la vista inicial; “Editar catálogo en tabla” permite editar registros existentes. “Agregar materia prima individual” conserva el formulario de alta individual.

## Copiar desde Excel

1. En Materias primas, pulsa “Copiar de Tabla”. Se abre una pantalla de carga independiente que siempre comienza vacía, sin los registros guardados del catálogo.
2. Pega tus celdas de Excel con Ctrl+V en la primera celda, que recibe el foco al abrir. Si pegas 30 filas se crean automáticamente 30 filas de datos. No hay que agregarlas antes. Puedes incluir los encabezados originales. El límite es 500 filas por lote.
3. Revisa las celdas. Los proveedores nuevos se crean al confirmar; las unidades deben existir en Unidades. OZ se reconoce como onza de masa; una onza fluida requiere una unidad de volumen separada.
4. Edita directamente las celdas que necesites y pulsa “Guardar”. Se abre la revisión del lote; los errores indican la fila y el campo. Cierra la revisión para corregir las celdas.
5. Si hay coincidencias, elige actualizar o agregar una presentación intencionalmente. Confirmar guarda el lote completo; un error revierte todo el lote.

“Cancelar” sale sin guardar y pide confirmación si hay datos pendientes. Al volver a abrir “Copiar de Tabla”, comienza una carga vacía. La última línea vacía de la tabla permite escribir o seguir pegando y no cuenta como registro hasta que recibe datos. En esta pantalla solo están los botones principales Guardar y Cancelar; las opciones de históricos y ayuda están dentro de un desplegable al pie.

Se conservan celdas vacías y texto de Excel con saltos de línea o tabulaciones entre comillas. Los precios admiten `Q 120.00`, `Q2.40`, números sin símbolo, separadores de miles y coma decimal sin separadores de miles. Las fechas admiten día/mes/año o año-mes-día. La capacidad, por ejemplo `54 OZ`, es solo texto informativo: con presentación 50 y precio Q120, el precio unitario es Q2.40.

Las cantidades admiten hasta 8 decimales y los precios hasta 4. La hoja muestra hasta 6 decimales en los cálculos, sin redondear los valores almacenados más allá de la precisión de sus columnas.

## Editar y copiar rangos

- Edita las celdas manuales directamente. Los cálculos permanecen de solo lectura.
- Selecciona un rango arrastrando, con Mayús + clic o con Mayús + flechas.
- Ctrl+C copia el rango y Ctrl+V lo pega desde la celda superior izquierda. En la vista de edición del catálogo, “Copiar tabla” incluye los encabezados.
- Mayús + Supr vacía las celdas editables del rango. Las columnas calculadas no se vacían.
- Los cambios permanecen como borrador hasta revisar y confirmar. Navegar fuera, cambiar empresa, cerrar sesión o descartar pide confirmar si hay cambios pendientes.
- En celular, desliza horizontalmente la hoja para llegar a todas las columnas. El pegado depende del menú de portapapeles del navegador y teclado del dispositivo.

## Precio anterior y VS

PRECIO UN = PRECIO PRESENTACION / PRESENTACION. VS = precio unitario actual menos precio unitario anterior normalizado a la unidad de la fila. Se comparan cotizaciones de la misma materia prima, dimensión y moneda; pueden ser de diferentes proveedores o cantidades. No se convierten masa a volumen ni monedas. El orden histórico es fecha de consulta, instante de registro e ID como desempate. Los registros futuros no son vigentes hasta su fecha.

Los valores pegados en PRECIO UN y VS nunca sustituyen los cálculos. Si faltan antecedentes comparables, VS muestra un guion.

Al pegar antecedentes en las columnas PRECIO ANTERIOR y PROVEEDOR ANTERIOR, se activa el modo de importación inicial. Por defecto se conservan como referencias sin unidad ni fecha conocidas y no se usan para calcular VS. Solo elige “precio por la misma unidad” o “precio total de la misma cantidad y unidad” cuando conozcas explícitamente esa interpretación. No se inventa una fecha anterior.

Las referencias importadas quedan en el registro de cotización y se pueden consultar en el historial. Nunca se sobrescriben los precios históricos. Si se cambia proveedor, cantidad o unidad de una presentación existente, se archiva la presentación anterior y se crea otra; el historial sigue enlazado a la original. Los nombres y nombres alternativos pertenecen a la materia prima y se comparten entre sus presentaciones.

## Persistencia y seguridad

save_material_sheet es una función SECURITY INVOKER: usa los permisos del usuario y RLS. Solo admin/editor de la empresa pueden guardar; viewer puede consultar/copiar. Las referencias mantienen claves compuestas por empresa. Los nombres de proveedores y materias primas, y símbolos de unidades, tienen índices únicos normalizados para espacios y mayúsculas. Las presentaciones duplicadas requieren confirmación explícita en el lote.

Los cambios del lote se ejecutan en una sola transacción. Un ID de lote hace seguros los reintentos tras perder una respuesta. Se rechazan filas archivadas y conflictos con un precio cambiado desde otra sesión. catalog_batches conserva el registro privado de la operación; su contenido solo puede consultarlo su autor con permiso de edición.

## Verificación

`npm test` cubre TSV, celdas vacías y entre comillas, monedas, fechas, capacidad informativa, historial desconocido y normalización de unidades. `supabase/tests/material_sheet.sql` comprueba en una transacción con rollback el guardado atómico, historial, orden en un mismo día, duplicados, reintentos, conversiones y aislamiento entre empresas/roles.

La prueba visual local en `qa/sheet.html` usa datos sintéticos y no se incluye en el build de Pages. Permite comprobar pegado, selección, copia, duplicados y revisión sin iniciar sesión. No pulsar guardar en esa vista: no tiene una sesión de Supabase.
