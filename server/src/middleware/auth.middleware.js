const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/database');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authentication token required. Please log in.', 'AUTH_REQUIRED');
  }

  const token = authHeader.slice(7).trim();
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwt.secret);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired authentication token.', 'INVALID_TOKEN');
  }

  const userRes = await query(
    `SELECT u.user_id, u.employee_code, u.full_name, u.email, u.role,
            u.assigned_center_id, u.is_active, cc.name AS center_name
       FROM users u
       LEFT JOIN collection_centers cc ON cc.center_id = u.assigned_center_id
      WHERE u.user_id = $1`,
    [decoded.userId]
  );

  if (userRes.rowCount === 0 || !userRes.rows[0].is_active) {
    throw new ApiError(401, 'Account is inactive or no longer exists.', 'ACCOUNT_INACTIVE');
  }

  req.user = userRes.rows[0];
  next();
});

module.exports = { authenticate };
