const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const repairsService = require('./repairs.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await repairsService.listRepairs();
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'REPAIR_OPERATOR'),
  asyncHandler(async (req, res) => {
    const repair = await repairsService.createRepairTicket(req.body, req.user, req.ip);
    res.status(201).json({ success: true, data: repair });
  })
);

router.patch(
  '/:repairId/resolve',
  authenticate,
  authorizeRoles('ADMIN', 'REPAIR_OPERATOR'),
  asyncHandler(async (req, res) => {
    const repair = await repairsService.resolveRepairTicket(
      req.params.repairId,
      req.body,
      req.user,
      req.ip
    );
    res.json({ success: true, data: repair });
  })
);

module.exports = router;
