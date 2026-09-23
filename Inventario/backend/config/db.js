const path = require('path');
const mysql = require('mysql2/promise');
// El .env está en la carpeta Inventario. Se carga con su ruta exacta: antes se
// buscaba en la carpeta desde donde se arrancaba, y si alguien corría el
// servidor desde otra carpeta, se quedaba sin base de datos ni clave.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true, // los DECIMAL de MySQL llegan como number de JS, no como string
  dateStrings: ['DATE'], // una fecha (sin hora) llega como '2026-09-22', sin líos de zona horaria
});

// Cada conexión trabaja en READ COMMITTED: después de esperar el bloqueo de
// un material (SELECT ... FOR UPDATE), las lecturas ven lo que otra persona
// acaba de guardar. Con el modo por omisión de MariaDB (REPEATABLE READ) se
// podía calcular con datos de unos segundos antes: dos personas cortando la
// misma lámina al mismo tiempo podían dejarla en negativo.
pool.pool.on('connection', (conexion) => {
  conexion.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  // La base de datos habla en hora de Panamá, igual que el servidor (TZ en
  // server.js). Si la VM tiene la hora del sistema en UTC, sin esto las
  // horas de "registrado el" salían corridas 5 horas.
  conexion.query("SET time_zone = '-05:00'");
});

module.exports = pool;
