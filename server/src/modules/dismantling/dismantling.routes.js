const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const dismantlingService = require('./dismantling.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await dismantlingService.listDismantlingOperations();
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'RECYCLING_MANAGER'),
  asyncHandler(async (req, res) => {
    const result = await dismantlingService.executeDismantling(req.body, req.user, req.ip);
    res.status(201).json({ success: true, data: result });
  })
);

module.exports = router;
