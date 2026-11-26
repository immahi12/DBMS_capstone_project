const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const componentsService = require('./components.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await componentsService.listRecoveredComponents(req.query);
    res.json({ success: true, data });
  })
);

router.get(
  '/:uid/lineage',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await componentsService.getComponentRecursiveLineage(req.params.uid);
    res.json({ success: true, data });
  })
);

router.patch(
  '/:id/status',
  authenticate,
  authorizeRoles('ADMIN', 'RECYCLING_MANAGER', 'REPAIR_OPERATOR'),
  asyncHandler(async (req, res) => {
    const updated = await componentsService.updateComponentStatus(req.params.id, req.body, req.user);
    res.json({ success: true, data: updated });
  })
);

module.exports = router;
