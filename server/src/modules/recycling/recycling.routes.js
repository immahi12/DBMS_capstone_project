const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const recyclingService = require('./recycling.service');

const router = express.Router();

router.get(
  '/facilities',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await recyclingService.listFacilities();
    res.json({ success: true, data });
  })
);

router.post(
  '/facilities',
  authenticate,
  authorizeRoles('ADMIN', 'RECYCLING_MANAGER'),
  asyncHandler(async (req, res) => {
    const facility = await recyclingService.createFacility(req.body, req.user);
    res.status(201).json({ success: true, data: facility });
  })
);

module.exports = router;
