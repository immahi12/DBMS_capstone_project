const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const materialsService = require('./materials.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await materialsService.listMaterialRecoveries();
    res.json({ success: true, data });
  })
);

router.post(
  '/recover',
  authenticate,
  authorizeRoles('ADMIN', 'RECYCLING_MANAGER'),
  asyncHandler(async (req, res) => {
    const record = await materialsService.recordMaterialRecovery(req.body, req.user, req.ip);
    res.status(201).json({ success: true, data: record });
  })
);

module.exports = router;
