-- ============================================================================
-- Graphic Center — Inventario
-- Migración 003 — la merma vuelve a descontar
--
--     sudo mysql graphic_center_inventario < database/migracion-003-merma-descuenta.sql
--
-- Contexto: por un tiempo la merma quedó como simple registro, sin descontar.
-- Se decidió volver atrás: la merma descuenta del material y del rollo, igual
-- que antes. Esto deja las mermas ya registradas igual que las nuevas.
--
-- IMPORTANTE: esto REEMPLAZA el bloque comentado del final de la migración 001
-- (el que decía "descomenta si quieres que las mermas dejen de descontar").
-- Ignóralo: la decisión fue la contraria.
--
-- Respaldo antes:
--     sudo mysqldump graphic_center_inventario > ~/respaldo-antes-003.sql
-- ============================================================================

USE graphic_center_inventario;

-- ---------------------------------------------------------------------------
-- 1) ¿Cuántas mermas hay sin descontar?
--
-- Si la app estuvo poco tiempo con la merma "solo registro", lo más probable
-- es que esto devuelva cero filas y no haya nada que hacer.
-- ---------------------------------------------------------------------------

SELECT m.codigo,
       m.descripcion,
       COUNT(*)         AS mermas_sin_descontar,
       SUM(mv.cantidad) AS cantidad_que_se_va_a_descontar
  FROM movimientos mv
  JOIN materiales m ON m.id = mv.material_id
 WHERE mv.tipo = 'MERMA'
   AND mv.descuenta = FALSE
   AND mv.anulado = FALSE
   AND mv.anula_movimiento_id IS NULL
 GROUP BY m.codigo, m.descripcion
 ORDER BY cantidad_que_se_va_a_descontar DESC;

-- ---------------------------------------------------------------------------
-- 2) Ponerlas a descontar
--
-- Solo toca las mermas vigentes. Las anuladas y los contra-movimientos de
-- anulación se quedan como están: esos no cuentan para nada.
-- ---------------------------------------------------------------------------

UPDATE movimientos
   SET descuenta = TRUE
 WHERE tipo = 'MERMA'
   AND descuenta = FALSE
   AND anulado = FALSE
   AND anula_movimiento_id IS NULL;

SELECT ROW_COUNT() AS mermas_actualizadas;

-- ---------------------------------------------------------------------------
-- 3) ¿Quedó algún material en negativo?
--
-- Puede pasar si mientras la merma no descontaba se registraron mermas
-- mayores a lo que había. Si aquí sale alguna fila, arréglala desde la
-- aplicación con un Ajuste por conteo físico: entra a Inventario, busca el
-- material, botón "Ajuste", y pon la cantidad que hay de verdad en bodega.
--
-- No lo corrijas por SQL: el ajuste deja constancia de quién contó y cuándo.
-- ---------------------------------------------------------------------------

SELECT m.codigo,
       m.descripcion,
       ROUND(COALESCE(m.inventario_inicial, 0) + COALESCE(x.efecto, 0), 4) AS existencia_ahora
  FROM materiales m
  LEFT JOIN (
        SELECT mv.material_id,
               SUM(CASE
                     WHEN mv.tipo = 'ENTRADA' THEN  mv.cantidad
                     WHEN mv.tipo = 'SALIDA'  THEN -mv.cantidad
                     WHEN mv.tipo = 'MERMA' AND mv.descuenta THEN -mv.cantidad
                     WHEN mv.tipo = 'AJUSTE'  THEN  mv.cantidad
                     ELSE 0
                   END) AS efecto
          FROM movimientos mv
         WHERE mv.anulado = FALSE AND mv.anula_movimiento_id IS NULL
         GROUP BY mv.material_id
       ) x ON x.material_id = m.id
 WHERE m.activo = TRUE
   AND COALESCE(m.inventario_inicial, 0) + COALESCE(x.efecto, 0) < 0
 ORDER BY existencia_ahora;

-- ---------------------------------------------------------------------------
-- Listo. Reinicia el backend (npm start) después de correr esto.
-- ---------------------------------------------------------------------------
