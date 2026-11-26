const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const inspectionsService = require('./inspections.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await inspectionsService.listInspections();
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'INSPECTOR'),
  asyncHandler(async (req, res) => {
    const result = await inspectionsService.createInspection(req.body, req.user, req.ip);
    res.status(201).json({ success: true, data: result });
  })
);

module.exports = router;
