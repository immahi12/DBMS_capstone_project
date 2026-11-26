-- ============================================================================
-- ReLoop: E-Waste Lifecycle & Recycling Tracker
-- Migration 004: Relational Views, Analytical Views, and Materialized View
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. View: vw_device_master_overview
-- Multi-table operational view combining device, category, center, batch & donor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_device_master_overview AS
SELECT
    d.device_id,
    d.device_uid,
    d.tracking_number,
    d.brand,
    d.model_name,
    d.serial_number,
    d.manufacture_year,
    d.weight_kg,
    d.estimated_value_inr,
    d.current_status,
    d.condition_grade,
    d.contains_hazardous_materials,
    d.registered_at,
    d.updated_at,
    c.category_id,
    c.category_code,
    c.name              AS category_name,
    pc.name             AS parent_category_name,
    c.hazard_level      AS category_hazard_level,
    cb.collection_id,
    cb.batch_number,
    cb.collection_date,
    cb.source_type,
    org.organization_id,
    COALESCE(org.name, 'Individual Citizen Walk-In') AS source_organization_name,
    cc.center_id        AS current_center_id,
    cc.center_code      AS current_center_code,
    cc.name             AS current_center_name,
    cc.city             AS current_center_city,
    u.full_name         AS registered_by_name
FROM devices d
INNER JOIN e_waste_categories c   ON c.category_id    = d.category_id
LEFT  JOIN e_waste_categories pc  ON pc.category_id   = c.parent_category_id
INNER JOIN collection_batches cb  ON cb.collection_id = d.collection_id
LEFT  JOIN organizations org      ON org.organization_id = cb.source_organization_id
INNER JOIN collection_centers cc  ON cc.center_id     = d.current_center_id
INNER JOIN users u                ON u.user_id        = d.registered_by;

-- ----------------------------------------------------------------------------
-- 2. View: vw_component_full_lineage
-- Preserves complete component-level traceability from donor & source device
-- through dismantling to reuse target device, recycler, or hazardous TSDF.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_component_full_lineage AS
SELECT
    rc.recovered_component_id,
    rc.component_uid,
    rc.serial_or_part_no,
    rc.condition_status,
    rc.weight_kg,
    rc.estimated_value_inr,
    rc.current_status,
    rc.destination_type,
    rc.recovered_at,
    rc.destination_notes,
    rc.parent_recovered_component_id,
    prc.component_uid          AS parent_component_uid,
    cat.component_type_id,
    cat.type_code              AS component_type_code,
    cat.name                   AS component_type_name,
    cat.component_group,
    sd.device_id               AS source_device_id,
    sd.tracking_number         AS source_device_tracking_no,
    sd.brand                   AS source_device_brand,
    sd.model_name              AS source_device_model,
    sd.current_status          AS source_device_status,
    dr.dismantling_id,
    dr.dismantling_code,
    dr.dismantled_at,
    rep.repair_id              AS installed_in_repair_id,
    rep.ticket_number          AS installed_in_repair_ticket,
    td.device_id               AS target_reuse_device_id,
    td.tracking_number         AS target_reuse_device_tracking_no,
    rf.facility_id             AS recycling_facility_id,
    rf.name                    AS recycling_facility_name,
    disp.manifest_number       AS hazardous_manifest_number
FROM recovered_components rc
INNER JOIN component_catalog cat   ON cat.component_type_id = rc.component_type_id
INNER JOIN devices sd              ON sd.device_id          = rc.source_device_id
INNER JOIN dismantling_records dr  ON dr.dismantling_id     = rc.dismantling_id
LEFT  JOIN recovered_components prc ON prc.recovered_component_id = rc.parent_recovered_component_id
LEFT  JOIN repair_records rep      ON rep.repair_id         = rc.installed_in_repair_id
LEFT  JOIN devices td              ON td.device_id          = rep.device_id
LEFT  JOIN recycling_facilities rf ON rf.facility_id        = rc.recycling_facility_id
LEFT  JOIN disposal_records disp   ON disp.recovered_component_id = rc.recovered_component_id;

-- ----------------------------------------------------------------------------
-- 3. View: vw_kpi_executive_summary
-- Real-time aggregate KPI view strictly separating device-level outcomes from
-- component-level counts to prevent double-counting.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_kpi_executive_summary AS
WITH device_agg AS (
    SELECT
        COUNT(*)                                                                  AS total_devices_collected,
        COALESCE(SUM(weight_kg), 0)                                               AS total_ewaste_weight_kg,
        COUNT(*) FILTER (WHERE current_status = 'UNDER_INSPECTION')               AS devices_under_inspection,
        COUNT(*) FILTER (WHERE current_status IN ('REFURBISHED', 'READY_FOR_REUSE')) AS devices_refurbished_or_reuse,
        COUNT(*) FILTER (WHERE current_status = 'REFURBISHED')                    AS devices_currently_refurbished,
        COUNT(*) FILTER (WHERE current_status = 'READY_FOR_REUSE')                AS devices_ready_for_reuse,
        COUNT(*) FILTER (WHERE current_status = 'RECYCLED')                       AS total_devices_recycled,
        COUNT(*) FILTER (WHERE current_status = 'DISPOSED')                       AS total_devices_disposed,
        COUNT(*) FILTER (
            WHERE current_status IN ('REFURBISHED', 'READY_FOR_REUSE', 'RECYCLED', 'DISPOSED')
        )                                                                         AS terminal_processed_devices
    FROM devices
),
repair_agg AS (
    SELECT
        COUNT(DISTINCT device_id) FILTER (WHERE repair_status = 'COMPLETED')      AS devices_repaired,
        COUNT(*) FILTER (WHERE repair_status = 'COMPLETED')                       AS completed_repair_tickets,
        COUNT(*) FILTER (WHERE repair_status IN ('COMPLETED', 'UNREPAIRABLE_ESCALATED')) AS closed_repair_tickets
    FROM repair_records
),
dismantle_agg AS (
    SELECT COUNT(DISTINCT device_id) AS devices_dismantled
    FROM dismantling_records
),
component_agg AS (
    SELECT
        COUNT(*) AS total_recovered_components,
        COUNT(*) FILTER (WHERE destination_type IN ('REUSE', 'RESALE', 'REPAIR')) AS reusable_components_count
    FROM recovered_components
),
material_agg AS (
    SELECT
        COALESCE(SUM(mrr.recovered_weight_kg), 0)                     AS total_material_recovered_kg,
        COALESCE(SUM(mrr.recovered_weight_kg * m.co2_saved_per_kg), 0) AS total_co2_saved_kg,
        COALESCE(SUM(mrr.recovered_weight_kg * m.market_value_per_kg_inr), 0) AS total_material_value_inr
    FROM material_recovery_records mrr
    INNER JOIN materials m ON m.material_id = mrr.material_id
)
SELECT
    da.total_devices_collected,
    ROUND(da.total_ewaste_weight_kg::NUMERIC, 2)       AS total_ewaste_weight_kg,
    da.devices_under_inspection,
    ra.devices_repaired,
    da.devices_refurbished_or_reuse                    AS devices_refurbished,
    da.devices_currently_refurbished,
    da.devices_ready_for_reuse,
    dma.devices_dismantled,
    da.total_devices_recycled,
    da.total_devices_disposed,
    ca.total_recovered_components,
    ca.reusable_components_count,
    ROUND(ma.total_material_recovered_kg::NUMERIC, 3)  AS total_material_recovered_kg,
    ROUND(ma.total_co2_saved_kg::NUMERIC, 2)           AS total_co2_saved_kg,
    ROUND(ma.total_material_value_inr::NUMERIC, 2)     AS total_material_value_inr,
    -- Device Recycling Rate: strictly devices reaching RECYCLED / terminally processed devices
    COALESCE(
        ROUND((100.0 * da.total_devices_recycled / NULLIF(da.terminal_processed_devices, 0))::NUMERIC, 2),
        0
    )                                                  AS recycling_rate_pct,
    -- Circular Diversion Rate: (Reuse + Refurbished + Recycled) / terminally processed devices
    COALESCE(
        ROUND((100.0 * (da.devices_refurbished_or_reuse + da.total_devices_recycled) / NULLIF(da.terminal_processed_devices, 0))::NUMERIC, 2),
        0
    )                                                  AS circular_diversion_rate_pct,
    -- Repair Success Rate: Completed QA-verified repairs / Closed repair tickets
    COALESCE(
        ROUND((100.0 * ra.completed_repair_tickets / NULLIF(ra.closed_repair_tickets, 0))::NUMERIC, 2),
        0
    )                                                  AS repair_success_rate_pct
FROM device_agg da
CROSS JOIN repair_agg ra
CROSS JOIN dismantle_agg dma
CROSS JOIN component_agg ca
CROSS JOIN material_agg ma;

-- ----------------------------------------------------------------------------
-- 4. View: vw_center_performance_metrics
-- Collection center operational throughput, active inventory load & utilization.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_center_performance_metrics AS
SELECT
    cc.center_id,
    cc.center_code,
    cc.name AS center_name,
    cc.city,
    cc.state,
    cc.operating_status,
    cc.storage_capacity_kg,
    COUNT(DISTINCT cb.collection_id)                                              AS total_batches_received,
    COUNT(d.device_id)                                                            AS total_devices_assigned,
    COALESCE(ROUND(SUM(d.weight_kg)::NUMERIC, 2), 0)                              AS total_weight_handled_kg,
    COALESCE(ROUND(SUM(d.weight_kg) FILTER (
        WHERE d.current_status NOT IN ('READY_FOR_REUSE', 'RECYCLED', 'DISPOSED')
    )::NUMERIC, 2), 0)                                                            AS active_inventory_weight_kg,
    COALESCE(ROUND((
        100.0 * SUM(d.weight_kg) FILTER (
            WHERE d.current_status NOT IN ('READY_FOR_REUSE', 'RECYCLED', 'DISPOSED')
        ) / NULLIF(cc.storage_capacity_kg, 0)
    )::NUMERIC, 2), 0)                                                            AS capacity_utilization_pct,
    COUNT(d.device_id) FILTER (WHERE d.current_status IN ('REFURBISHED', 'READY_FOR_REUSE')) AS refurbished_reuse_count,
    COUNT(d.device_id) FILTER (WHERE d.current_status = 'RECYCLED')               AS recycled_count,
    COUNT(d.device_id) FILTER (WHERE d.current_status = 'DISPOSED')               AS disposed_count
FROM collection_centers cc
LEFT JOIN devices d             ON d.current_center_id = cc.center_id
LEFT JOIN collection_batches cb ON cb.center_id        = cc.center_id
GROUP BY
    cc.center_id, cc.center_code, cc.name, cc.city, cc.state,
    cc.operating_status, cc.storage_capacity_kg;

-- ----------------------------------------------------------------------------
-- 5. View: vw_facility_performance_metrics
-- Downstream recycling & hazardous treatment facility performance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_facility_performance_metrics AS
WITH mat_by_fac AS (
    SELECT
        mrr.facility_id,
        COUNT(*)                                                          AS recovery_lots_count,
        COUNT(*) FILTER (WHERE mrr.recycling_status = 'PROCESSED_VERIFIED') AS verified_lots_count,
        COALESCE(SUM(mrr.recovered_weight_kg), 0)                         AS total_recovered_kg,
        COALESCE(AVG(mrr.purity_grade_pct), 0)                            AS avg_purity_pct,
        COALESCE(SUM(mrr.recovered_weight_kg * m.market_value_per_kg_inr), 0) AS recovered_value_inr,
        COALESCE(SUM(mrr.recovered_weight_kg * m.co2_saved_per_kg), 0)    AS co2_saved_kg
    FROM material_recovery_records mrr
    INNER JOIN materials m ON m.material_id = mrr.material_id
    GROUP BY mrr.facility_id
),
disp_by_fac AS (
    SELECT
        facility_id,
        COUNT(*)                              AS disposal_manifests_count,
        COALESCE(SUM(hazard_weight_kg), 0)    AS total_hazard_disposed_kg,
        COALESCE(SUM(disposal_cost_inr), 0)   AS total_disposal_cost_inr
    FROM disposal_records
    GROUP BY facility_id
)
SELECT
    rf.facility_id,
    rf.facility_code,
    rf.name AS facility_name,
    rf.facility_type,
    rf.city,
    rf.state,
    rf.certification_number,
    rf.license_valid_until,
    rf.authorized_for_hazardous,
    rf.processing_capacity_tons_month,
    COALESCE(mf.recovery_lots_count, 0)                     AS recovery_lots_count,
    COALESCE(mf.verified_lots_count, 0)                     AS verified_lots_count,
    ROUND(COALESCE(mf.total_recovered_kg, 0)::NUMERIC, 3)   AS total_recovered_kg,
    ROUND(COALESCE(mf.avg_purity_pct, 0)::NUMERIC, 2)       AS avg_purity_pct,
    ROUND(COALESCE(mf.recovered_value_inr, 0)::NUMERIC, 2)  AS recovered_value_inr,
    ROUND(COALESCE(mf.co2_saved_kg, 0)::NUMERIC, 2)         AS co2_saved_kg,
    COALESCE(df.disposal_manifests_count, 0)                AS disposal_manifests_count,
    ROUND(COALESCE(df.total_hazard_disposed_kg, 0)::NUMERIC, 3) AS total_hazard_disposed_kg,
    ROUND(COALESCE(df.total_disposal_cost_inr, 0)::NUMERIC, 2)  AS total_disposal_cost_inr
FROM recycling_facilities rf
LEFT JOIN mat_by_fac mf  ON mf.facility_id = rf.facility_id
LEFT JOIN disp_by_fac df ON df.facility_id = rf.facility_id;

-- ----------------------------------------------------------------------------
-- 6. Materialized View: mv_monthly_ewaste_summary
-- Pre-aggregated historical monthly intake & circular recovery rollups.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_ewaste_summary;

CREATE MATERIALIZED VIEW mv_monthly_ewaste_summary AS
SELECT
    TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM') AS month_bucket,
    c.category_id,
    c.name                                                      AS category_name,
    COUNT(d.device_id)                                          AS devices_collected,
    ROUND(COALESCE(SUM(d.weight_kg), 0)::NUMERIC, 3)            AS total_collected_kg,
    COUNT(d.device_id) FILTER (
        WHERE d.current_status IN ('REFURBISHED', 'READY_FOR_REUSE')
    )                                                           AS devices_reused_or_refurbished,
    COUNT(d.device_id) FILTER (
        WHERE d.current_status = 'RECYCLED'
    )                                                           AS devices_recycled,
    COUNT(d.device_id) FILTER (
        WHERE d.current_status = 'DISPOSED'
    )                                                           AS devices_disposed
FROM collection_batches cb
INNER JOIN devices d            ON d.collection_id = cb.collection_id
INNER JOIN e_waste_categories c ON c.category_id   = d.category_id
GROUP BY
    TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM'),
    c.category_id,
    c.name
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_monthly_ewaste_summary
    ON mv_monthly_ewaste_summary (month_bucket, category_id);

-- Stored procedure to refresh materialized analytics concurrently
CREATE OR REPLACE PROCEDURE sp_refresh_analytics_views()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_ewaste_summary;
END;
$$;
