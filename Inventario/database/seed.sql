-- ============================================================================
-- Graphic Center — Datos iniciales
-- Todo tomado del archivo bodega_gcp_4.html. Donde el original dice
-- "POR CONFIRMAR" o deja el valor vacío, aquí queda NULL — no se inventa nada.
-- ============================================================================

-- Los acentos se guardan bien aunque la terminal esté en otro idioma
SET NAMES utf8mb4;

USE graphic_center_inventario;

-- ---------------------------------------------------------------------------
-- Usuario administrador inicial
--
-- Usuario:    admin
-- Contraseña: GraphicCenter2026!   ← PROVISIONAL
--
-- El sistema la marca como provisional: al entrar la primera vez pide
-- cambiarla, y hasta que se cambie ese usuario puede mirar pero no registrar
-- nada. Esta contraseña está escrita aquí, así que cualquiera que vea este
-- archivo la conoce: cámbiala apenas entres.
-- ---------------------------------------------------------------------------
-- Se entra con USUARIO, no con correo. El correo queda opcional (NULL) para
-- avisos a futuro; no hace falta inventar correos ficticios.
INSERT INTO usuarios (usuario, nombre, email, password_hash, rol, debe_cambiar_password) VALUES
('admin', 'Administrador', NULL,
 '$2b$10$U6llx3B/uQvba5U3wHHERe7ILWHTjc4gpUnMvCiCgex28I6taE61q', 'ADMIN', TRUE);

-- ---------------------------------------------------------------------------
-- Bodegas y áreas
-- ---------------------------------------------------------------------------
INSERT INTO bodegas (nombre) VALUES ('BUNKER'), ('TALLER');

INSERT INTO areas (nombre) VALUES
('TALLER GRAFICO'),('TALLER DE BORDADOS'),('DTF'),('SERIGRAFIA'),
('ESTRUCTURAS'),('INSTALACION'),('DISENO'),('ADMINISTRACION'),('VENTAS');

-- ---------------------------------------------------------------------------
-- Unidades de medida
-- ---------------------------------------------------------------------------
INSERT INTO unidades_medida (codigo, nombre) VALUES
('UNIDAD','Unidad'),
('LAMINA','Lámina'),
('ROLLO','Rollo'),
('PIE LINEAL','Pie lineal'),
('METRO LINEAL','Metro lineal'),
('PULGADA','Pulgada'),
('PIE2','Pie cuadrado (ft²)'),
('METRO2','Metro cuadrado (m²)'),
('LITRO','Litro'),
('GALON','Galón'),
('CAJA','Caja'),
('PAQUETE','Paquete');

-- ---------------------------------------------------------------------------
-- Categorías y subcategorías (17 categorías, tal cual el original)
-- ---------------------------------------------------------------------------
INSERT INTO categorias (nombre) VALUES
('VINILES'),('BANNER Y LONAS'),('LAMINAS'),('PAPELERIA'),('MATERIAL POP'),
('IMPRESION'),('LAMINADOS'),('BORDADO'),('DTF'),('ELECTRICIDAD / LED'),
('ESTRUCTURAS'),('INSTALACION'),('INSUMOS'),('HERRAMIENTAS'),('EQUIPOS'),
('EMPAQUE'),('OTROS');

INSERT INTO subcategorias (categoria_id, nombre)
SELECT id, sub FROM categorias
JOIN (
  SELECT 'VINILES' AS cat, 'Vinil de impresion' AS sub UNION ALL
  SELECT 'VINILES','Vinil especial' UNION ALL
  SELECT 'VINILES','Vinil de corte' UNION ALL
  SELECT 'VINILES','Microperforado y vidrio' UNION ALL
  SELECT 'VINILES','Otros viniles' UNION ALL
  SELECT 'BANNER Y LONAS','Banner' UNION ALL
  SELECT 'BANNER Y LONAS','Lona' UNION ALL
  SELECT 'BANNER Y LONAS','Mesh' UNION ALL
  SELECT 'BANNER Y LONAS','Textil' UNION ALL
  SELECT 'BANNER Y LONAS','Otros' UNION ALL
  SELECT 'LAMINAS','PVC espumoso' UNION ALL
  SELECT 'LAMINAS','Foam Board' UNION ALL
  SELECT 'LAMINAS','Acrilico' UNION ALL
  SELECT 'LAMINAS','ACM' UNION ALL
  SELECT 'LAMINAS','Coroplast' UNION ALL
  SELECT 'LAMINAS','Policarbonato' UNION ALL
  SELECT 'LAMINAS','Lamina galvanizada' UNION ALL
  SELECT 'LAMINAS','Lamina fosfatada' UNION ALL
  SELECT 'LAMINAS','Lamina de aluminio' UNION ALL
  SELECT 'LAMINAS','MDF y madera' UNION ALL
  SELECT 'LAMINAS','Otras laminas' UNION ALL
  SELECT 'PAPELERIA','Papel bond' UNION ALL
  SELECT 'PAPELERIA','Papel fotografico' UNION ALL
  SELECT 'PAPELERIA','Papel adhesivo' UNION ALL
  SELECT 'PAPELERIA','Cartulina' UNION ALL
  SELECT 'PAPELERIA','Papel sintetico' UNION ALL
  SELECT 'PAPELERIA','Papel transfer' UNION ALL
  SELECT 'PAPELERIA','Sobres' UNION ALL
  SELECT 'PAPELERIA','Etiquetas' UNION ALL
  SELECT 'PAPELERIA','Otros papeles' UNION ALL
  SELECT 'MATERIAL POP','Roll Up' UNION ALL
  SELECT 'MATERIAL POP','X-Banner / Aranas' UNION ALL
  SELECT 'MATERIAL POP','Counters' UNION ALL
  SELECT 'MATERIAL POP','Displays' UNION ALL
  SELECT 'MATERIAL POP','Porta brochure' UNION ALL
  SELECT 'MATERIAL POP','Muppis' UNION ALL
  SELECT 'MATERIAL POP','Bases' UNION ALL
  SELECT 'MATERIAL POP','Estructuras promocionales' UNION ALL
  SELECT 'IMPRESION','Tintas' UNION ALL
  SELECT 'IMPRESION','Cabezales y repuestos' UNION ALL
  SELECT 'IMPRESION','Consumibles de impresora' UNION ALL
  SELECT 'IMPRESION','Limpieza de impresora' UNION ALL
  SELECT 'LAMINADOS','Laminado brillante' UNION ALL
  SELECT 'LAMINADOS','Laminado mate' UNION ALL
  SELECT 'LAMINADOS','Laminado UV' UNION ALL
  SELECT 'LAMINADOS','Laminado alto trafico' UNION ALL
  SELECT 'LAMINADOS','Otros laminados' UNION ALL
  SELECT 'BORDADO','Hilos' UNION ALL
  SELECT 'BORDADO','Entretelas' UNION ALL
  SELECT 'BORDADO','Agujas y bobinas' UNION ALL
  SELECT 'BORDADO','Repuestos de bordadora' UNION ALL
  SELECT 'BORDADO','Insumos de bordado' UNION ALL
  SELECT 'DTF','Film DTF' UNION ALL
  SELECT 'DTF','Tintas DTF' UNION ALL
  SELECT 'DTF','Polvo DTF' UNION ALL
  SELECT 'DTF','Quimicos DTF' UNION ALL
  SELECT 'DTF','Repuestos DTF' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Modulos LED' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Tiras LED' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Neon Flex' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Fuentes y controladores' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Cableado' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Accesorios electricos' UNION ALL
  SELECT 'ELECTRICIDAD / LED','Proteccion' UNION ALL
  SELECT 'ESTRUCTURAS','Perfileria' UNION ALL
  SELECT 'ESTRUCTURAS','Tubo y angulo' UNION ALL
  SELECT 'ESTRUCTURAS','Lamina metalica' UNION ALL
  SELECT 'ESTRUCTURAS','Soportes y bases' UNION ALL
  SELECT 'ESTRUCTURAS','Soldadura' UNION ALL
  SELECT 'INSTALACION','Adhesivos y siliconas' UNION ALL
  SELECT 'INSTALACION','Cintas' UNION ALL
  SELECT 'INSTALACION','Fijaciones' UNION ALL
  SELECT 'INSTALACION','Herramental de rotulacion' UNION ALL
  SELECT 'INSTALACION','Consumibles de instalacion' UNION ALL
  SELECT 'INSUMOS','Cuchillas' UNION ALL
  SELECT 'INSUMOS','Tape' UNION ALL
  SELECT 'INSUMOS','Siliconas' UNION ALL
  SELECT 'INSUMOS','Pegamentos' UNION ALL
  SELECT 'INSUMOS','Alcohol y limpieza' UNION ALL
  SELECT 'INSUMOS','Tornillos' UNION ALL
  SELECT 'INSUMOS','Remaches' UNION ALL
  SELECT 'INSUMOS','Bridas' UNION ALL
  SELECT 'INSUMOS','Guantes' UNION ALL
  SELECT 'INSUMOS','Brocas' UNION ALL
  SELECT 'INSUMOS','Discos' UNION ALL
  SELECT 'INSUMOS','Lijas' UNION ALL
  SELECT 'INSUMOS','Otros consumibles' UNION ALL
  SELECT 'HERRAMIENTAS','Herramienta electrica' UNION ALL
  SELECT 'HERRAMIENTAS','Herramienta manual' UNION ALL
  SELECT 'HERRAMIENTAS','Medicion' UNION ALL
  SELECT 'HERRAMIENTAS','Escaleras y andamios' UNION ALL
  SELECT 'EQUIPOS','Impresoras' UNION ALL
  SELECT 'EQUIPOS','Bordadoras' UNION ALL
  SELECT 'EQUIPOS','Corte y router' UNION ALL
  SELECT 'EQUIPOS','Prensas' UNION ALL
  SELECT 'EQUIPOS','Otros equipos' UNION ALL
  SELECT 'EMPAQUE','Film y burbuja' UNION ALL
  SELECT 'EMPAQUE','Cajas y carton' UNION ALL
  SELECT 'EMPAQUE','Cintas de empaque' UNION ALL
  SELECT 'EMPAQUE','Etiquetas' UNION ALL
  SELECT 'EMPAQUE','Otros' UNION ALL
  SELECT 'OTROS','Sin clasificar'
) AS s ON s.cat = categorias.nombre;

-- ---------------------------------------------------------------------------
-- Materiales (20 del original). bodega/ubicacion NULL porque el original
-- los trae vacíos; inventario_inicial y precision EXACTAMENTE como el original.
-- ---------------------------------------------------------------------------
INSERT INTO materiales (codigo, descripcion, categoria_id, subcategoria_id, unidad_id, inventario_inicial, precision_inicial, observaciones)
SELECT d.cod, d.desc_, c.id, sc.id, u.id, d.inicial, d.prec, d.obs
FROM (
  SELECT 'VIN-BRI-001' cod,'Vinil blanco brillante para impresion' desc_,'VINILES' cat,'Vinil de impresion' sub,'PIE LINEAL' um, NULL inicial,'POR_CONFIRMAR' prec,'' obs UNION ALL
  SELECT 'VIN-B54-031','Vinil brillante 54 pulg (medida por confirmar)','VINILES','Vinil de impresion','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'VIN-TRA-003','Vinil transparente para impresion','VINILES','Vinil de impresion','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'VIN-REF-018','Vinil reflectivo','VINILES','Vinil especial','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'VIN-ALT-019','Vinil alto trafico (piso)','VINILES','Vinil especial','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'VIN-MAG-020','Vinil magnetico','VINILES','Vinil especial','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'MIC-EST-001','Microperforado estandar','VINILES','Microperforado y vidrio','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-BRI-001','Banner brillante','BANNER Y LONAS','Banner','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-MAT-002','Banner mate','BANNER Y LONAS','Banner','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-PET-003','PET Banner','BANNER Y LONAS','Banner','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-SRF-016','Banner S/R (nombre exacto por confirmar)','BANNER Y LONAS','Banner','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-MES-009','Banner Mesh','BANNER Y LONAS','Mesh','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'BAN-CAN-011','Canvas para impresion','BANNER Y LONAS','Textil','PIE LINEAL',NULL,'POR_CONFIRMAR','' UNION ALL
  SELECT 'FOA-03M-001','Foam Board 3 mm','LAMINAS','Foam Board','LAMINA',8,'EXACTO','Medida de lamina por confirmar' UNION ALL
  SELECT 'FOA-10M-003','Foam Board 10 mm','LAMINAS','Foam Board','LAMINA',11,'EXACTO','Medida de lamina por confirmar' UNION ALL
  SELECT 'PVC-XXX-011','PVC espumoso - espesor por confirmar','LAMINAS','PVC espumoso','LAMINA',12,'POR_CONFIRMAR','Reclasificar al espesor correcto' UNION ALL
  SELECT 'EQU-XBA-001','Arana / X-Banner','MATERIAL POP','X-Banner / Aranas','UNIDAD',15,'EXACTO','' UNION ALL
  SELECT 'EQU-RXB-002','Repuestos de arana / X-Banner (incompletos)','MATERIAL POP','X-Banner / Aranas','UNIDAD',2,'ESTIMADO','Verificar piezas faltantes' UNION ALL
  SELECT 'EQU-ROL-003','Roll Up','MATERIAL POP','Roll Up','UNIDAD',0,'EXACTO','' UNION ALL
  SELECT 'EQU-COU-004','Counter','MATERIAL POP','Counters','UNIDAD',3,'EXACTO',''
) d
JOIN categorias c ON c.nombre = d.cat
JOIN subcategorias sc ON sc.categoria_id = c.id AND sc.nombre = d.sub
JOIN unidades_medida u ON u.codigo = d.um;

-- ---------------------------------------------------------------------------
-- Rollos (23 del original, ligados a los materiales de arriba por código)
-- ---------------------------------------------------------------------------
INSERT INTO rollos (id, material_id, ancho, largo, estado, precision_medida, origen)
SELECT r.id, m.id, r.ancho, r.largo, r.estado, r.prec, 'inicial'
FROM (
  SELECT 'VIN-BRI-001-R01' id,'VIN-BRI-001' cod, NULL ancho, NULL largo,'POR_CONFIRMAR' estado,'POR_CONFIRMAR' prec UNION ALL
  SELECT 'VIN-BRI-001-R02','VIN-BRI-001',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'VIN-B54-031-R01','VIN-B54-031',54,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'VIN-TRA-003-R01','VIN-TRA-003',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'VIN-REF-018-R01','VIN-REF-018',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'VIN-REF-018-R02','VIN-REF-018',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'VIN-ALT-019-R01','VIN-ALT-019',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'VIN-MAG-020-R01','VIN-MAG-020',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'MIC-EST-001-R01','MIC-EST-001',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'BAN-BRI-001-R01','BAN-BRI-001',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'BAN-BRI-001-R02','BAN-BRI-001',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'BAN-BRI-001-R03','BAN-BRI-001',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'BAN-MAT-002-R01','BAN-MAT-002',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'BAN-PET-003-R01','BAN-PET-003',NULL,NULL,'SELLADO','EXACTO' UNION ALL
  SELECT 'BAN-PET-003-R02','BAN-PET-003',NULL,NULL,'SELLADO','EXACTO' UNION ALL
  SELECT 'BAN-PET-003-R03','BAN-PET-003',NULL,NULL,'SELLADO','EXACTO' UNION ALL
  SELECT 'BAN-PET-003-R04','BAN-PET-003',NULL,NULL,'SELLADO','EXACTO' UNION ALL
  SELECT 'BAN-SRF-016-R01','BAN-SRF-016',NULL,NULL,'POR_CONFIRMAR','POR_CONFIRMAR' UNION ALL
  SELECT 'BAN-SRF-016-R02','BAN-SRF-016',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'BAN-MES-009-R01','BAN-MES-009',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'BAN-MES-009-R02','BAN-MES-009',NULL,NULL,'ABIERTO','ESTIMADO' UNION ALL
  SELECT 'BAN-CAN-011-R01','BAN-CAN-011',NULL,NULL,'ABIERTO','ESTIMADO'
) r
JOIN materiales m ON m.codigo = r.cod;
