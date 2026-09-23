# Graphic Center — Inventario

Sistema de inventario interno del taller. Vive dentro de la carpeta del sitio
web (`GCPlus/Inventario`), pero es una aplicación aparte: su propio backend,
su base de datos y su login. Del sitio solo usa la hoja de estilos base
(`../css/style.css`) y el logo de `../assets`.

Qué maneja:

- **Materiales sueltos** (láminas contadas, equipos, papelería…): entradas,
  salidas, mermas y ajustes por conteo.
- **Rollos** (vinil, banner, lona: unidad *pie lineal* o *metro lineal*):
  cada rollo se registra aparte y el sistema sabe cuánto le queda.
- **Láminas de 4×8** (acrílico, MDF, coroplast, caucho, foam board, PVC
  espumoso: unidad *lámina*): cada lámina se registra aparte y en la salida
  se ponen las medidas del corte.
- **Proveedores y facturas** en las entradas, con reportes de cuánto se le
  compró a cada uno.
- **Costos y valor del inventario**, con exportación a Excel (CSV).

---

## 1. Instalar

Dentro de la carpeta `Inventario/`:

```bash
npm install          # la primera vez
# en la VM de producción conviene:  npm ci --omit=dev
```

## 2. Base de datos (MariaDB)

Instalación nueva (crea la base, las tablas y los datos iniciales):

```bash
sudo mysql --default-character-set=utf8mb4 < database/schema.sql
sudo mysql --default-character-set=utf8mb4 graphic_center_inventario < database/seed.sql
```

Usuario de base de datos solo para la aplicación (no uses root):

```sql
CREATE USER 'app_inventario'@'localhost' IDENTIFIED BY 'una-clave-fuerte-aqui';
GRANT SELECT, INSERT, UPDATE, DELETE ON graphic_center_inventario.* TO 'app_inventario'@'localhost';
FLUSH PRIVILEGES;
```

(No necesita más permisos: las migraciones se corren con `sudo mysql`.)

### Migraciones (bases que ya existían)

Se corren **en orden**, una sola vez cada una, con respaldo antes:

```bash
sudo mysqldump graphic_center_inventario > ~/respaldo-$(date +%F).sql
sudo mysql --default-character-set=utf8mb4 graphic_center_inventario < database/migracion-00X-....sql
```

| # | Archivo | Qué agrega |
|---|---------|------------|
| 001 | `migracion-001-merma-y-rollos.sql` | Rollos: campo `activo`, limpieza de "por confirmar" |
| 002 | `migracion-002-usuarios-y-anulacion.sql` | Login por usuario, rol VISTA, anulación de movimientos |
| 003 | `migracion-003-merma-descuenta.sql` | La merma descuenta existencia |
| 004 | `migracion-004-precision-rollos.sql` | Largo del rollo con 4 decimales |
| 005 | `migracion-005-proveedores-y-documento.sql` | Proveedores, N° de factura, arreglo de rollos huérfanos |
| 006 | `migracion-006-laminas.sql` | Láminas de 4×8 y espesor del material |
| 007 | `migracion-007-revision.sql` | Llaves que faltaban, acentos rotos, contraseña de fábrica |

Si una migración muestra `ERROR`, **para ahí** y restaura el respaldo.

## 3. Archivo .env

En `Inventario/.env` (no se sube a ningún lado; `chmod 600 .env`):

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=app_inventario
DB_PASSWORD=la-clave-que-pusiste-arriba
DB_NAME=graphic_center_inventario

JWT_SECRET=una-cadena-larga-y-aleatoria      # openssl rand -hex 32
JWT_EXPIRES_IN=12h

PORT=4000
TZ=America/Panama
```

Si falta algún dato, el sistema **no arranca** y dice cuál falta.

## 4. Arrancar

Para probar:

```bash
npm start
```

En producción conviene dejarlo como servicio, así arranca solo cuando se
enciende la VM y no se cae al cerrar la terminal:

```ini
# /etc/systemd/system/inventario.service
[Unit]
Description=Graphic Center - Inventario
After=network.target mariadb.service

[Service]
User=graphic-center-plus
WorkingDirectory=/home/graphic-center-plus/Documentos/GCPlus/Inventario
ExecStart=/usr/bin/node backend/server.js
Environment=NODE_ENV=production
Environment=TZ=America/Panama
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now inventario
sudo systemctl status inventario      # ver si está corriendo
journalctl -u inventario -f           # ver lo que va pasando
```

Después de copiar archivos nuevos: `sudo systemctl restart inventario`.

## 5. Entrar

- Desde la VM: `http://localhost:4000`
- Desde otra computadora del taller: `http://<IP-de-la-VM>:4000`
  (la IP se ve con `ip a`, la que empieza con `192.168.` o `10.`)

Usuario inicial: **admin**, contraseña **GraphicCenter2026!** — es
provisional: el sistema pide cambiarla al entrar y, hasta que se cambie, ese
usuario puede mirar pero no registrar nada.

## 6. Usuarios y permisos

| Rol | Puede |
|-----|-------|
| **ADMIN** | Todo: anular movimientos, eliminar materiales, rollos y láminas, administrar usuarios y catálogos |
| **OPERADOR** | El día a día: entradas, salidas, mermas, ajustes, editar materiales, rollos y láminas. No elimina ni anula |
| **VISTA** | Solo consulta |

Un usuario nunca se borra: se desactiva, para que el histórico siga diciendo
quién hizo cada movimiento. Al desactivarlo, deja de tener acceso de
inmediato.

---

## Mantenimiento

### Respaldos (lo más importante)

Respaldo diario automático, guardando 30 días:

```bash
sudo crontab -e
# una línea:
0 22 * * * mysqldump --single-transaction graphic_center_inventario | gzip > /var/backups/inventario/inv-$(date +\%F).sql.gz
```

```bash
sudo mkdir -p /var/backups/inventario
```

- Copia esos archivos fuera de la VM de vez en cuando (USB o Drive).
- **Una vez al mes, prueba restaurar uno** en una base de prueba: un respaldo
  que nunca se probó no es un respaldo.

```bash
sudo mysql -e "CREATE DATABASE prueba_restore"
zcat /var/backups/inventario/inv-2026-09-22.sql.gz | sudo mysql prueba_restore
sudo mysql -e "DROP DATABASE prueba_restore"
```

### Bitácora

`Inventario/logs/inventario-AAAA-MM-DD.log`, un archivo por día, se borran
solos a los 60 días. Ahí queda quién entró, quién registró qué y el detalle
de cualquier error.

### Seguridad (revisar de vez en cuando)

1. Que la contraseña de `admin` ya no sea la de fábrica.
2. MariaDB con `bind-address = 127.0.0.1` (solo la propia VM).
3. `ufw` permitiendo el puerto 4000 solo desde la red del taller, y el 22 si
   usas SSH.
4. `JWT_SECRET` largo y propio (si se cambia, todos tienen que volver a entrar).
5. La wifi del taller con clave, y la VM en la red del personal.
6. Que el sitio web público no publique la carpeta `Inventario/` (ni `.env`
   ni `logs/`).

### Si algo falla

| Síntoma | Qué mirar |
|---------|-----------|
| "La base de datos no está al día" | Falta correr una migración de `database/` |
| No entra nadie | ¿MariaDB encendido? `sudo systemctl status mariadb`. ¿`JWT_SECRET` en el `.env`? |
| "No hay conexión con el servidor" | El servicio está apagado: `sudo systemctl status inventario` |
| Una pantalla no cambia | Ctrl+Shift+R en el navegador (recarga sin caché) |
| Acentos raros (`LÃ¡mina`) | Correr la migración 007 |

---

## Dónde está cada cosa

```
Inventario/
├── backend/
│   ├── config/      db.js (conexión), csv.js (Excel), log.js (bitácora)
│   ├── middleware/  auth.js (permisos), errorHandler.js
│   ├── services/    inventario.service.js (existencia, movimientos)
│   │                laminas.service.js (cortes de lámina)
│   ├── controllers/ un archivo por pantalla
│   └── routes/      las direcciones de la API
├── frontend/        index.html + js/ (una pantalla por archivo)
├── database/        schema.sql, seed.sql y las migraciones
└── logs/            bitácora diaria
```

Reglas del sistema que conviene no romper:

- La existencia **nunca se guarda**: siempre se calcula como
  inventario inicial + movimientos. Por eso nada se borra: se anula.
- Un movimiento anulado y su contra-movimiento no cuentan para nada, pero
  quedan a la vista.
- La merma nunca puede dejar la existencia en negativo.
- Lo que le queda a un rollo o a una lámina también se calcula, no se guarda.
