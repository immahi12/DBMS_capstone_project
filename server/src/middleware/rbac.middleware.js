const { query } = require('../config/database');
const ApiError = require('../utils/ApiError');

function authorizeRoles(...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new ApiError(401, 'Unauthenticated request', 'AUTH_REQUIRED'));
      }

      if (!allowedRoles.includes(req.user.role)) {
        // Record unauthorized RBAC attempt directly in audit_logs
        await query(
          `INSERT INTO audit_logs (table_name, record_pk, action_type, actor_user_id, new_payload, ip_address)
           VALUES ('rbac_guard', $1, 'RBAC_DENIED', $2, $3::jsonb, $4)`,
          [
            `${req.method} ${req.originalUrl}`,
            req.user.user_id,
            JSON.stringify({
              userRole: req.user.role,
              requiredRoles: allowedRoles,
              endpoint: req.originalUrl,
            }),
            req.ip || null,
          ]
        ).catch(() => {});

        return next(
          new ApiError(
            403,
            `Role '${req.user.role}' does not have permission for this action. Required: ${allowedRoles.join(', ')}`,
            'FORBIDDEN_ROLE'
          )
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { authorizeRoles };
