const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { query } = require('./config/database');
const { errorMiddleware } = require('./middleware/error.middleware');

const authRoutes = require('./modules/auth/auth.routes');
const collectionsRoutes = require('./modules/collections/collections.routes');
const devicesRoutes = require('./modules/devices/devices.routes');
const inspectionsRoutes = require('./modules/inspections/inspections.routes');
const repairsRoutes = require('./modules/repairs/repairs.routes');
const dismantlingRoutes = require('./modules/dismantling/dismantling.routes');
const componentsRoutes = require('./modules/components/components.routes');
const materialsRoutes = require('./modules/materials/materials.routes');
const recyclingRoutes = require('./modules/recycling/recycling.routes');
const disposalRoutes = require('./modules/disposal/disposal.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health & PostgreSQL Liveness Probe
app.get('/api/health', async (req, res, next) => {
  try {
    const dbCheck = await query(
      `SELECT current_database() AS database,
              NOW() AS server_time,
              (SELECT COUNT(*) FROM devices) AS devices_count`
    );
    res.json({
      success: true,
      status: 'healthy',
      db: dbCheck.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// Mount Feature Modules
app.use('/api/auth', authRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/inspections', inspectionsRoutes);
app.use('/api/repairs', repairsRoutes);
app.use('/api/dismantling', dismantlingRoutes);
app.use('/api/components', componentsRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/recycling', recyclingRoutes);
app.use('/api/disposal', disposalRoutes);
app.use('/api/analytics', analyticsRoutes);

// Return 404 JSON for unknown /api routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `API endpoint ${req.method} ${req.originalUrl} does not exist.`,
    },
  });
});

// Serve Vanilla JS + HTML5 + CSS3 Frontend
const clientDir = path.resolve(__dirname, '../../client');
app.use(express.static(clientDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.use(errorMiddleware);

module.exports = app;
