const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/movimientos.controller');
const { requireAuth, requireAdmin, requireEscritura } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', ctrl.listar);
router.get('/resumen', ctrl.resumen);
router.get('/exportar.csv', ctrl.exportarCsv);

router.post('/entrada', requireEscritura, ctrl.entrada);
router.post('/salida', requireEscritura, ctrl.salida);
router.post('/merma', requireEscritura, ctrl.merma);
router.post('/ajuste', requireEscritura, ctrl.ajuste);

// Completar el proveedor y la factura de una entrada: no mueve existencia,
// así que lo puede hacer quien registra movimientos.
router.put('/:id/documento', requireEscritura, ctrl.actualizarDocumento);

// Anular un movimiento es solo de administradores.
router.post('/:id/anular', requireAdmin, ctrl.anular);

module.exports = router;
