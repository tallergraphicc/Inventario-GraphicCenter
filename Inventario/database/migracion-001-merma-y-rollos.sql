-- ============================================================================
-- Graphic Center — Inventario
-- Migración 001
--
-- Se corre UNA sola vez sobre una base que ya existe:
--
--     mysql -u root -p graphic_center_inventario < database/migracion-001-merma-y-rollos.sql
--
-- Si vas a crear la base desde cero con schema.sql + seed.sql, NO hace falta
-- correr esto: schema.sql ya viene corregido.
-- ============================================================================

USE graphic_center_inventario;

-- ---------------------------------------------------------------------------
-- 1) Columna `activo` de la tabla rollos
--
-- El código ya la usaba (eliminar un rollo lo desactiva en vez de borrarlo)
-- pero nunca estuvo en schema.sql. Sin ella, el listado de rollos falla con
-- "Unknown column 'r.activo' in 'where clause'".
-- ---------------------------------------------------------------------------

ALTER TABLE rollos
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE rollos
  ADD INDEX IF NOT EXISTS idx_rollos_material (material_id, activo);

-- ---------------------------------------------------------------------------
-- 2) Las mermas dejan de descontar
--
-- De ahora en adelante toda merma nueva se guarda con descuenta = 0: queda
-- registrada en Movimientos pero no baja la existencia del material ni el
-- restante del rollo. Eso lo hace el backend solo, no hay nada que migrar.
--
-- Lo que SÍ hay que decidir es qué hacer con las mermas VIEJAS, que se
-- guardaron descontando. Están comentadas a propósito: descoméntalas solo si
-- quieres que las mermas ya registradas también dejen de descontar.
--
-- OJO: esto SUBE la existencia de los materiales que tenían mermas, porque
-- deja de restarles esa cantidad. Haz un respaldo antes:
--     mysqldump -u root -p graphic_center_inventario > respaldo-antes-migracion.sql
-- ---------------------------------------------------------------------------

-- Para ver primero a qué materiales afectaría y por cuánto:
SELECT m.codigo,
       m.descripcion,
       COUNT(*)          AS mermas_que_aun_descuentan,
       SUM(mv.cantidad)  AS cantidad_que_se_devolveria
FROM movimientos mv
JOIN materiales m ON m.id = mv.material_id
WHERE mv.tipo = 'MERMA' AND mv.descuenta = TRUE
GROUP BY m.codigo, m.descripcion
ORDER BY cantidad_que_se_devolveria DESC;

-- Y si estás de acuerdo con el resultado de arriba, descomenta esta línea:
-- UPDATE movimientos SET descuenta = FALSE WHERE tipo = 'MERMA';

-- ---------------------------------------------------------------------------
-- 3) Rollos ya medidos que se quedaron en "POR_CONFIRMAR"
--
-- Un rollo que YA tiene largo no está por confirmar. Esto limpia los que
-- quedaron marcados así por el bug de la pantalla de edición.
-- ---------------------------------------------------------------------------

UPDATE rollos
   SET estado = 'SELLADO'
 WHERE estado = 'POR_CONFIRMAR'
   AND largo IS NOT NULL;

UPDATE rollos
   SET precision_medida = 'ESTIMADO'
 WHERE precision_medida = 'POR_CONFIRMAR'
   AND largo IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Materiales por rollo que ya están medidos pero seguían "por confirmar"
--
-- Si TODOS los rollos activos de un material ya tienen largo y precisión
-- definida, el material tampoco está por confirmar.
-- ---------------------------------------------------------------------------

UPDATE materiales m
   SET m.precision_inicial = 'ESTIMADO'
 WHERE m.precision_inicial = 'POR_CONFIRMAR'
   AND EXISTS (
         SELECT 1 FROM rollos r
          WHERE r.material_id = m.id AND r.activo = TRUE
       )
   AND NOT EXISTS (
         SELECT 1 FROM rollos r
          WHERE r.material_id = m.id
            AND r.activo = TRUE
            AND (r.largo IS NULL OR r.precision_medida = 'POR_CONFIRMAR')
       );

-- ---------------------------------------------------------------------------
-- Listo. Reinicia el backend (npm start) después de correr esto.
-- ---------------------------------------------------------------------------
