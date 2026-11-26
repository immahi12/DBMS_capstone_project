const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const { query } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function loginUser({ email, password, clientIp }) {
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.', 'VALIDATION_ERROR');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const userRes = await query(
    `SELECT u.user_id, u.employee_code, u.full_name, u.email, u.password_hash,
            u.role, u.assigned_center_id, u.is_active, cc.name AS center_name
       FROM users u
       LEFT JOIN collection_centers cc ON cc.center_id = u.assigned_center_id
      WHERE LOWER(u.email) = $1`,
    [normalizedEmail]
  );

  if (userRes.rowCount === 0) {
    throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  }

  const user = userRes.rows[0];
  if (!user.is_active) {
    throw new ApiError(403, 'User account is deactivated.', 'ACCOUNT_DISABLED');
  }

  const validPassword = await bcrypt.compare(String(password), user.password_hash);
  if (!validPassword) {
    throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  }

  await query('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [user.user_id]);
  await query(
    `INSERT INTO audit_logs (table_name, record_pk, action_type, actor_user_id, new_payload, ip_address)
     VALUES ('users', $1, 'AUTH_LOGIN', $2, $3::jsonb, $4)`,
    [
      String(user.user_id),
      user.user_id,
      JSON.stringify({ email: user.email, role: user.role }),
      clientIp || null,
    ]
  );

  const token = jwt.sign(
    { userId: user.user_id, role: user.role, email: user.email },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  return {
    token,
    user: {
      user_id: user.user_id,
      employee_code: user.employee_code,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      assigned_center_id: user.assigned_center_id,
      center_name: user.center_name,
    },
  };
}

async function listStaffUsers() {
  const res = await query(
    `SELECT u.user_id, u.employee_code, u.full_name, u.email, u.role,
            u.assigned_center_id, cc.name AS center_name, u.last_login_at
       FROM users u
       LEFT JOIN collection_centers cc ON cc.center_id = u.assigned_center_id
      WHERE u.is_active = TRUE
      ORDER BY u.user_id ASC`
  );
  return res.rows;
}

module.exports = { loginUser, listStaffUsers };
