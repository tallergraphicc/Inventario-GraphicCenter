-- Graphic Center — Inventario
-- Vacía el historial operativo (movimientos, rollos y láminas de prueba)
-- y deja el catálogo de materiales intacto, con la existencia de cada uno
-- vuelta a "Por confirmar", lista para cargar los rollos/láminas reales.
--
-- NO borra: materiales, categorías/subcategorías, unidades, bodegas,
-- proveedores ni usuarios.

START TRANSACTION;

-- 0) 'movimientos' se referencia a sí misma (anula_movimiento_id, para
--    saber qué movimiento anuló a cuál) — hay que soltar esa referencia
--    antes de poder borrar, si no la base rechaza el borrado.
UPDATE movimientos SET anula_movimiento_id = NULL WHERE anula_movimiento_id IS NOT NULL;

-- 1) Todo el historial de entradas/salidas/mermas/ajustes
DELETE FROM movimientos;

-- 2) Láminas individuales cargadas de prueba
DELETE FROM laminas;

-- 3) Rollos individuales cargados de prueba
DELETE FROM rollos;

-- 4) La existencia de cada material vuelve a "Por confirmar" (igual que un
--    material recién creado sin indicar cuánto había). No toca código,
--    descripción, categoría, unidad, bodega, costo ni mínimo.
UPDATE materiales
SET inventario_inicial = NULL,
    precision_inicial  = 'POR_CONFIRMAR';

-- 5) Solo prolijidad: que el próximo movimiento vuelva a empezar en el 1.
ALTER TABLE movimientos AUTO_INCREMENT = 1;

COMMIT;