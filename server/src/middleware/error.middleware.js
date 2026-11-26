const ApiError = require('../utils/ApiError');

/**
 * Centralized error handler mapping custom ApiErrors and PostgreSQL SQLSTATE codes
 * (triggers, constraints, foreign keys, uniqueness, transaction serialization)
 * into clean, user-safe HTTP responses.
 */
function errorMiddleware(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || undefined,
      },
    });
  }

  // PostgreSQL Custom Trigger Exceptions (P0001..P0004)
  if (err && typeof err.code === 'string') {
    switch (err.code) {
      case 'P0001':
        return res.status(400).json({
          success: false,
          error: {
            code: 'LIFECYCLE_RULE_VIOLATION',
            message: err.message,
          },
        });
      case 'P0002':
        return res.status(403).json({
          success: false,
          error: {
            code: 'IMMUTABLE_LEDGER_VIOLATION',
            message: err.message,
          },
        });
      case 'P0003':
        return res.status(400).json({
          success: false,
          error: {
            code: 'HAZARDOUS_COMPLIANCE_VIOLATION',
            message: err.message,
          },
        });
      case 'P0004':
        return res.status(400).json({
          success: false,
          error: {
            code: 'COMPONENT_LINEAGE_VIOLATION',
            message: err.message,
          },
        });
      case '23505': // unique_violation
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_RECORD',
            message: err.detail || 'A record with this unique identifier already exists.',
            constraint: err.constraint,
          },
        });
      case '23503': // foreign_key_violation
        return res.status(400).json({
          success: false,
          error: {
            code: 'FOREIGN_KEY_VIOLATION',
            message: err.detail || 'Referenced parent/child record violates relational integrity.',
            constraint: err.constraint,
          },
        });
      case '23514': // check_violation
        return res.status(400).json({
          success: false,
          error: {
            code: 'CHECK_CONSTRAINT_VIOLATION',
            message: `Database CHECK constraint '${err.constraint}' rejected the input value.`,
            constraint: err.constraint,
          },
        });
      case '23502': // not_null_violation
        return res.status(400).json({
          success: false,
          error: {
            code: 'NOT_NULL_VIOLATION',
            message: `Required column '${err.column}' cannot be null.`,
          },
        });
      case '40001': // serialization_failure
        return res.status(409).json({
          success: false,
          error: {
            code: 'CONCURRENT_MODIFICATION',
            message: 'Concurrent transaction conflict detected. Please retry.',
          },
        });
      default:
        break;
    }
  }

  console.error('[Unhandled Server Error]:', err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred while processing the request.',
    },
  });
}

module.exports = { errorMiddleware };
