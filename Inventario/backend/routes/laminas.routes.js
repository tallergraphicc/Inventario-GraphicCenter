const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/laminas.controller');
const { requireAuth, requireAdmin, requireEscritura } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', ctrl.listar);
router.get('/exportar.csv', ctrl.exportarCsv);

router.post('/', requireEscritura, ctrl.crear);
router.post('/retazos/botar', requireEscritura, ctrl.botarRetazos);
router.put('/:id', requireEscritura, ctrl.actualizar);
router.post('/:id/terminar', requireEscritura, ctrl.terminar);
router.post('/:id/reabrir', requireEscritura, ctrl.reabrir);

// Eliminar una lámina es solo de administradores, igual que un rollo.
router.delete('/:id', requireAdmin, ctrl.eliminar);

module.exports = router;
