const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate } = require('../../middleware/auth.middleware');
const authService = require('./auth.service');

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const result = await authService.loginUser({
      email: req.body.email,
      password: req.body.password,
      clientIp: req.ip,
    });
    res.json({ success: true, data: result });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: req.user });
  })
);

router.get(
  '/users',
  authenticate,
  asyncHandler(async (req, res) => {
    const users = await authService.listStaffUsers();
    res.json({ success: true, data: users });
  })
);

module.exports = router;
