const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'reloop_db',
    user: process.env.DB_USER || 'reloop_admin',
    password: process.env.DB_PASSWORD || 'reloop_secure_pass_2026',
    max: parseInt(process.env.DB_MAX_POOL || '20', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'reloop_capstone_jwt_signing_key_2026_viva_edition',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
};

module.exports = env;
