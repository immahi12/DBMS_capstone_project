const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const devicesService = require('./devices.service');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const devices = await devicesService.listDevices(req.query);
    res.json({ success: true, data: devices });
  })
);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COLLECTION_MANAGER'),
  asyncHandler(async (req, res) => {
    const device = await devicesService.registerDevice(req.body, req.user, req.ip);
    res.status(201).json({ success: true, data: device });
  })
);

router.get(
  '/:identifier/traceability',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await devicesService.getFullDeviceTraceability(req.params.identifier);
    res.json({ success: true, data });
  })
);

router.get(
  '/:identifier',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await devicesService.getFullDeviceTraceability(req.params.identifier);
    res.json({ success: true, data });
  })
);

router.patch(
  '/:identifier/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const updated = await devicesService.transitionDeviceStatus(
      req.params.identifier,
      req.body,
      req.user,
      req.ip
    );
    res.json({ success: true, data: updated });
  })
);

router.post(
  '/:identifier/transfer',
  authenticate,
  authorizeRoles('ADMIN', 'COLLECTION_MANAGER', 'RECYCLING_MANAGER'),
  asyncHandler(async (req, res) => {
    const transfer = await devicesService.transferDevice(
      req.params.identifier,
      req.body,
      req.user,
      req.ip
    );
    res.status(201).json({ success: true, data: transfer });
  })
);

module.exports = router;
