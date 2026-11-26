const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const analyticsService = require('./analytics.service');

const router = express.Router();

router.get(
  '/dashboard',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await analyticsService.getDashboardAnalytics();
    res.json({ success: true, data });
  })
);

router.get(
  '/reports',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await analyticsService.getDeepReports();
    res.json({ success: true, data });
  })
);

router.get(
  '/viva-queries',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: analyticsService.listVivaQueries() });
  })
);

router.post(
  '/viva-queries/:queryId/run',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await analyticsService.runVivaQueryById(req.params.queryId);
    res.json({ success: true, data });
  })
);

router.post(
  '/refresh-views',
  authenticate,
  authorizeRoles('ADMIN', 'RECYCLING_MANAGER'),
  asyncHandler(async (req, res) => {
    const data = await analyticsService.refreshMaterializedViews();
    res.json({ success: true, data });
  })
);

module.exports = router;
