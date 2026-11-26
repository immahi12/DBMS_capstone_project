const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorizeRoles } = require('../../middleware/rbac.middleware');
const collectionsService = require('./collections.service');

const router = express.Router();

router.get(
  '/meta',
  authenticate,
  asyncHandler(async (req, res) => {
    const meta = await collectionsService.getReferenceMetadata();
    res.json({ success: true, data: meta });
  })
);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COLLECTION_MANAGER'),
  asyncHandler(async (req, res) => {
    const batch = await collectionsService.createCollectionBatch(req.body, req.user);
    res.status(201).json({ success: true, data: batch });
  })
);

module.exports = router;
