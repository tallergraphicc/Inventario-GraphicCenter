const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/catalogos.controller');
const { requireAuth, requireAdmin, requireEscritura } = require('../middleware/auth');

router.use(requireAuth);

router.get('/categorias', ctrl.listarCategorias);
router.get('/unidades', ctrl.listarUnidades);
router.get('/bodegas', ctrl.listarBodegas);
router.get('/areas', ctrl.listarAreas);
router.get('/proveedores', ctrl.listarProveedores);

router.post('/categorias', requireEscritura, ctrl.crearCategoria);
router.post('/categorias/:categoriaId/subcategorias', requireEscritura, ctrl.crearSubcategoria);
router.post('/bodegas', requireEscritura, ctrl.crearBodega);
router.post('/areas', requireEscritura, ctrl.crearArea);
router.post('/unidades', requireEscritura, ctrl.crearUnidad);
router.post('/proveedores', requireEscritura, ctrl.crearProveedor);

// Borrar del catálogo es solo de administradores: afecta a todo el sistema.
router.delete('/categorias/:id', requireAdmin, ctrl.eliminarCategoria);
router.delete('/subcategorias/:id', requireAdmin, ctrl.eliminarSubcategoria);
router.delete('/bodegas/:id', requireAdmin, ctrl.eliminarBodega);
router.delete('/areas/:id', requireAdmin, ctrl.eliminarArea);
router.delete('/unidades/:id', requireAdmin, ctrl.eliminarUnidad);
router.delete('/proveedores/:id', requireAdmin, ctrl.eliminarProveedor);

module.exports = router;
