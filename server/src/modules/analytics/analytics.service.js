const { pool, query } = require('../../config/database');
const { VIVA_QUERIES } = require('../../database/queries/viva_catalog');
const ApiError = require('../../utils/ApiError');

async function getDashboardAnalytics() {
  const [
    kpiRes,
    monthlyTrendRes,
    categoryDistRes,
    centerPerfRes,
    facilityPerfRes,
    statusPipelineRes,
    recentEventsRes,
  ] = await Promise.all([
    query('SELECT * FROM vw_kpi_executive_summary'),
    query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM') AS month_bucket,
        COUNT(d.device_id) AS devices_collected,
        ROUND(COALESCE(SUM(d.weight_kg), 0)::NUMERIC, 2) AS weight_collected_kg,
        COUNT(d.device_id) FILTER (WHERE d.current_status IN ('REFURBISHED', 'READY_FOR_REUSE')) AS reused_refurbished,
        COUNT(d.device_id) FILTER (WHERE d.current_status = 'RECYCLED') AS recycled_devices,
        COUNT(d.device_id) FILTER (WHERE d.current_status = 'DISPOSED') AS disposed_devices
      FROM collection_batches cb
      INNER JOIN devices d ON d.collection_id = cb.collection_id
      GROUP BY TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM')
      ORDER BY month_bucket ASC;
    `),
    query(`
      SELECT
        c.category_id,
        c.name AS category_name,
        c.hazard_level,
        COUNT(d.device_id) AS device_count,
        ROUND(COALESCE(SUM(d.weight_kg), 0)::NUMERIC, 2) AS total_weight_kg,
        ROUND((100.0 * COUNT(d.device_id) / NULLIF((SELECT COUNT(*) FROM devices), 0))::NUMERIC, 2) AS device_share_pct
      FROM e_waste_categories c
      INNER JOIN devices d ON d.category_id = c.category_id
      GROUP BY c.category_id, c.name, c.hazard_level
      ORDER BY total_weight_kg DESC;
    `),
    query('SELECT * FROM vw_center_performance_metrics ORDER BY total_weight_handled_kg DESC'),
    query('SELECT * FROM vw_facility_performance_metrics ORDER BY total_recovered_kg DESC'),
    query(`
      SELECT
        current_status,
        COUNT(*) AS count,
        ROUND(COALESCE(SUM(weight_kg), 0)::NUMERIC, 2) AS weight_kg
      FROM devices
      GROUP BY current_status
      ORDER BY count DESC;
    `),
    query(`
      SELECT
        le.event_id,
        d.tracking_number,
        d.brand || ' ' || d.model_name AS device_name,
        le.from_status,
        le.to_status,
        le.notes,
        le.occurred_at,
        u.full_name AS actor_name
      FROM lifecycle_events le
      INNER JOIN devices d ON d.device_id = le.device_id
      INNER JOIN users u   ON u.user_id   = le.changed_by
      ORDER BY le.occurred_at DESC, le.event_id DESC
      LIMIT 12;
    `),
  ]);

  return {
    kpis: kpiRes.rows[0],
    monthly_trends: monthlyTrendRes.rows,
    category_distribution: categoryDistRes.rows,
    center_performance: centerPerfRes.rows,
    facility_performance: facilityPerfRes.rows,
    status_pipeline: statusPipelineRes.rows,
    recent_lifecycle_events: recentEventsRes.rows,
  };
}

async function getDeepReports() {
  const [
    mvSummaryRes,
    materialBreakdownRes,
    stageDwellRes,
    auditLogsRes,
  ] = await Promise.all([
    query('SELECT * FROM mv_monthly_ewaste_summary ORDER BY month_bucket DESC, total_collected_kg DESC'),
    query(`
      SELECT
        m.material_code,
        m.name AS material_name,
        m.material_class,
        m.is_hazardous,
        COUNT(mrr.recovery_id) AS shipments,
        COALESCE(ROUND(SUM(mrr.recovered_weight_kg)::NUMERIC, 4), 0) AS recovered_kg,
        COALESCE(ROUND(SUM(mrr.recovered_weight_kg * m.market_value_per_kg_inr)::NUMERIC, 2), 0) AS economic_value_inr,
        COALESCE(ROUND(SUM(mrr.recovered_weight_kg * m.co2_saved_per_kg)::NUMERIC, 2), 0) AS co2_offset_kg
      FROM materials m
      LEFT JOIN material_recovery_records mrr ON mrr.material_id = m.material_id
      GROUP BY m.material_id, m.material_code, m.name, m.material_class, m.is_hazardous
      ORDER BY recovered_kg DESC;
    `),
    // Window function dwell-time report across stages!
    query(`
      WITH stage_transitions AS (
        SELECT
          le.from_status AS stage_name,
          EXTRACT(EPOCH FROM (
            le.occurred_at - LAG(le.occurred_at) OVER (
              PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
            )
          )) / 3600.0 AS dwell_hours
        FROM lifecycle_events le
      )
      SELECT
        stage_name,
        COUNT(*) AS transitions_observed,
        ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours,
        ROUND(MIN(dwell_hours)::NUMERIC, 2) AS min_dwell_hours,
        ROUND(MAX(dwell_hours)::NUMERIC, 2) AS max_dwell_hours
      FROM stage_transitions
      WHERE stage_name IS NOT NULL AND dwell_hours IS NOT NULL
      GROUP BY stage_name
      ORDER BY avg_dwell_hours DESC;
    `),
    query(`
      SELECT
        al.log_id,
        al.table_name,
        al.record_pk,
        al.action_type,
        u.full_name AS actor_name,
        u.role AS actor_role,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON u.user_id = al.actor_user_id
      ORDER BY al.log_id DESC
      LIMIT 30;
    `),
  ]);

  return {
    materialized_monthly_summary: mvSummaryRes.rows,
    material_recovery_breakdown: materialBreakdownRes.rows,
    stage_dwell_analytics: stageDwellRes.rows,
    recent_audit_logs: auditLogsRes.rows,
  };
}

function listVivaQueries() {
  return VIVA_QUERIES;
}

async function runVivaQueryById(queryId) {
  const item = VIVA_QUERIES.find((q) => q.id.toUpperCase() === String(queryId).toUpperCase());
  if (!item) {
    throw new ApiError(404, `Viva query '${queryId}' not found.`, 'QUERY_NOT_FOUND');
  }

  const client = await pool.connect();
  const started = Date.now();
  try {
    // Strictly READ ONLY transaction so benchmark/EXPLAIN ANALYZE queries never mutate state
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query(item.sql);
    await client.query('ROLLBACK');
    const elapsedMs = Date.now() - started;

    return {
      query: item,
      execution_ms: elapsedMs,
      row_count: result.rows.length,
      columns: result.fields.map((f) => f.name),
      rows: result.rows,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function refreshMaterializedViews() {
  await query('CALL sp_refresh_analytics_views()');
  return { refreshed_at: new Date().toISOString() };
}

module.exports = {
  getDashboardAnalytics,
  getDeepReports,
  listVivaQueries,
  runVivaQueryById,
  refreshMaterializedViews,
};
