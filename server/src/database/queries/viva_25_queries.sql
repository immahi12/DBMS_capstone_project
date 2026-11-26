-- ============================================================================
-- ReLoop: 26 DBMS Capstone Viva & Analytical SQL Queries (PostgreSQL 17)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q01: Multi-Table INNER JOIN: Complete Device Intake & Donor Provenance
-- Objective: Retrieve corporate-donated devices with their batch, category, collection hub, and registering officer.
-- Concepts: INNER JOIN, 5-Table Join, Projection & Ordering
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  d.brand || ' ' || d.model_name AS device_model,
  c.name AS category_name,
  cb.batch_number,
  o.name AS donor_organization,
  cc.name AS current_hub,
  u.full_name AS registered_by,
  d.current_status
FROM devices d
INNER JOIN e_waste_categories c  ON c.category_id = d.category_id
INNER JOIN collection_batches cb ON cb.collection_id = d.collection_id
INNER JOIN organizations o       ON o.organization_id = cb.source_organization_id
INNER JOIN collection_centers cc ON cc.center_id = d.current_center_id
INNER JOIN users u               ON u.user_id = d.registered_by
ORDER BY cb.collection_date DESC, d.tracking_number ASC
LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q02: LEFT JOIN: Collection Center Capacity & Idle Hub Detection
-- Objective: Evaluate all collection centers—including hubs under maintenance with zero active devices—showing weight load vs capacity.
-- Concepts: LEFT JOIN, COALESCE, GROUP BY, Conditional Aggregation
-- ----------------------------------------------------------------------------
SELECT
  cc.center_code,
  cc.name AS center_name,
  cc.operating_status,
  cc.storage_capacity_kg,
  COUNT(d.device_id) AS assigned_devices,
  COALESCE(ROUND(SUM(d.weight_kg)::NUMERIC, 2), 0) AS total_weight_kg,
  COALESCE(ROUND((100.0 * SUM(d.weight_kg) / NULLIF(cc.storage_capacity_kg, 0))::NUMERIC, 2), 0) AS load_pct
FROM collection_centers cc
LEFT JOIN devices d ON d.current_center_id = cc.center_id
GROUP BY cc.center_id, cc.center_code, cc.name, cc.operating_status, cc.storage_capacity_kg
ORDER BY total_weight_kg DESC;

-- ----------------------------------------------------------------------------
-- Q03: RIGHT JOIN: Material Catalog Coverage Across Recovery Shipments
-- Objective: List every regulated/recoverable raw material in the master catalog even if zero kilograms have been recovered in recovery lots so far.
-- Concepts: RIGHT JOIN, Aggregate SUM/COUNT, Unrecovered Material Detection
-- ----------------------------------------------------------------------------
SELECT
  m.material_code,
  m.name AS material_name,
  m.material_class,
  m.is_hazardous,
  COUNT(mrr.recovery_id) AS recovery_lot_count,
  COALESCE(ROUND(SUM(mrr.recovered_weight_kg)::NUMERIC, 4), 0) AS recovered_kg
FROM material_recovery_records mrr
RIGHT JOIN materials m ON m.material_id = mrr.material_id
GROUP BY m.material_id, m.material_code, m.name, m.material_class, m.is_hazardous
ORDER BY recovered_kg DESC, m.material_code ASC;

-- ----------------------------------------------------------------------------
-- Q04: FULL OUTER JOIN: Partner Organizations Donor vs Reuse Recipient Matrix
-- Objective: Reconcile organizations that supply e-waste batches against organizations that receive refurbished devices for reuse/grants.
-- Concepts: FULL OUTER JOIN, CTE, Circular Partnership Balance
-- ----------------------------------------------------------------------------
WITH donor_summary AS (
  SELECT
    cb.source_organization_id AS org_id,
    COUNT(DISTINCT cb.collection_id) AS batches_donated,
    COUNT(d.device_id) AS devices_supplied
  FROM collection_batches cb
  INNER JOIN devices d ON d.collection_id = cb.collection_id
  WHERE cb.source_organization_id IS NOT NULL
  GROUP BY cb.source_organization_id
),
recipient_summary AS (
  SELECT
    reuse_destination_org_id AS org_id,
    COUNT(repair_id) AS refurbished_devices_received
  FROM repair_records
  WHERE reuse_destination_org_id IS NOT NULL
  GROUP BY reuse_destination_org_id
)
SELECT
  o.organization_code,
  o.name AS organization_name,
  o.org_type,
  COALESCE(ds.batches_donated, 0) AS batches_donated,
  COALESCE(ds.devices_supplied, 0) AS devices_supplied,
  COALESCE(rs.refurbished_devices_received, 0) AS refurbished_devices_received
FROM donor_summary ds
FULL OUTER JOIN recipient_summary rs ON ds.org_id = rs.org_id
INNER JOIN organizations o ON o.organization_id = COALESCE(ds.org_id, rs.org_id)
ORDER BY devices_supplied DESC, refurbished_devices_received DESC;

-- ----------------------------------------------------------------------------
-- Q05: SELF JOIN: E-Waste Category Parent-Child Taxonomy Mapping
-- Objective: Join e_waste_categories to itself to display leaf categories alongside their immediate parent and root classification.
-- Concepts: SELF JOIN, Hierarchical Adjacency List
-- ----------------------------------------------------------------------------
SELECT
  child.category_code,
  child.name AS category_name,
  COALESCE(parent.name, '[Top-Level Root]') AS parent_category,
  COALESCE(grandparent.name, COALESCE(parent.name, child.name)) AS root_domain,
  child.hazard_level,
  child.base_recyclability_pct
FROM e_waste_categories child
LEFT JOIN e_waste_categories parent      ON parent.category_id = child.parent_category_id
LEFT JOIN e_waste_categories grandparent ON grandparent.category_id = parent.parent_category_id
ORDER BY root_domain, parent_category, child.name;

-- ----------------------------------------------------------------------------
-- Q06: Aggregates (COUNT, SUM, AVG, MIN, MAX): Category Mass & Valuation Profile
-- Objective: Compute comprehensive statistical mass and economic value metrics across e-waste categories having collected devices.
-- Concepts: COUNT, SUM, AVG, MIN, MAX, HAVING
-- ----------------------------------------------------------------------------
SELECT
  c.name AS category_name,
  COUNT(d.device_id) AS device_count,
  ROUND(SUM(d.weight_kg)::NUMERIC, 2) AS total_mass_kg,
  ROUND(AVG(d.weight_kg)::NUMERIC, 3) AS avg_mass_kg,
  ROUND(MIN(d.estimated_value_inr)::NUMERIC, 2) AS min_est_value_inr,
  ROUND(MAX(d.estimated_value_inr)::NUMERIC, 2) AS max_est_value_inr,
  ROUND(AVG(d.estimated_value_inr)::NUMERIC, 2) AS avg_est_value_inr
FROM e_waste_categories c
INNER JOIN devices d ON d.category_id = c.category_id
GROUP BY c.category_id, c.name
HAVING COUNT(d.device_id) >= 1
ORDER BY total_mass_kg DESC;

-- ----------------------------------------------------------------------------
-- Q07: Scalar Subqueries: Device Weight & Value Variance Against System Benchmarks
-- Objective: Identify high-value devices whose estimated value exceeds the platform-wide average, showing exact variance from global mean.
-- Concepts: Scalar Subquery in SELECT, Scalar Subquery in WHERE
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  d.brand || ' ' || d.model_name AS asset,
  d.estimated_value_inr,
  ROUND((SELECT AVG(estimated_value_inr) FROM devices)::NUMERIC, 2) AS global_avg_value_inr,
  ROUND((d.estimated_value_inr - (SELECT AVG(estimated_value_inr) FROM devices))::NUMERIC, 2) AS above_avg_delta_inr
FROM devices d
WHERE d.estimated_value_inr > (SELECT AVG(estimated_value_inr) FROM devices)
ORDER BY d.estimated_value_inr DESC
LIMIT 15;

-- ----------------------------------------------------------------------------
-- Q08: Correlated Subquery: Devices Heavier Than Their Own Category Average
-- Objective: Find devices whose physical mass exceeds the average mass of devices within the exact same e-waste category.
-- Concepts: Correlated Subquery, Category-Relative Benchmarking
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  c.name AS category_name,
  d.brand,
  d.model_name,
  d.weight_kg,
  (
    SELECT ROUND(AVG(d2.weight_kg)::NUMERIC, 3)
    FROM devices d2
    WHERE d2.category_id = d.category_id
  ) AS category_avg_weight_kg
FROM devices d
INNER JOIN e_waste_categories c ON c.category_id = d.category_id
WHERE d.weight_kg > (
  SELECT AVG(d2.weight_kg)
  FROM devices d2
  WHERE d2.category_id = d.category_id
)
ORDER BY c.name, d.weight_kg DESC;

-- ----------------------------------------------------------------------------
-- Q09: EXISTS: Dismantled Devices Yielding Circular Reusable Components
-- Objective: Locate dismantled source devices that contributed at least one working or repairable component back into the reuse economy.
-- Concepts: EXISTS, Semi-Join Optimization
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  d.brand,
  d.model_name,
  d.current_status,
  dr.dismantling_code,
  dr.total_components_extracted
FROM devices d
INNER JOIN dismantling_records dr ON dr.device_id = d.device_id
WHERE EXISTS (
  SELECT 1
  FROM recovered_components rc
  WHERE rc.source_device_id = d.device_id
    AND rc.condition_status IN ('WORKING', 'REPAIRABLE')
    AND rc.destination_type IN ('REUSE', 'RESALE', 'REPAIR')
)
ORDER BY dr.total_components_extracted DESC, d.tracking_number ASC;

-- ----------------------------------------------------------------------------
-- Q10: NOT EXISTS: Hazardous Devices Pending Authorized TSDF Disposal Manifest
-- Objective: Audit compliance risk by listing devices flagged as containing hazardous materials that have NOT yet received a whole-device or component TSDF disposal manifest.
-- Concepts: NOT EXISTS, Compliance Anti-Join
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  d.brand || ' ' || d.model_name AS device_name,
  d.current_status,
  cc.name AS current_center,
  d.registered_at::DATE AS intake_date
FROM devices d
INNER JOIN collection_centers cc ON cc.center_id = d.current_center_id
WHERE d.contains_hazardous_materials = TRUE
  AND d.current_status NOT IN ('READY_FOR_REUSE', 'REFURBISHED')
  AND NOT EXISTS (
    SELECT 1
    FROM disposal_records dr
    WHERE dr.device_id = d.device_id
  )
ORDER BY d.registered_at ASC
LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q11: IN & ALL / ANY Subqueries: Facilities Outperforming Non-Hazardous Recyclers
-- Objective: Find recycling facilities licensed for precious or battery metals whose monthly capacity exceeds ALL pure polymer recyclers.
-- Concepts: IN, ALL, ANY, Subquery Comparison Operators
-- ----------------------------------------------------------------------------
SELECT
  rf.facility_code,
  rf.name AS facility_name,
  rf.facility_type,
  rf.processing_capacity_tons_month
FROM recycling_facilities rf
WHERE rf.facility_id IN (
  SELECT fam.facility_id
  FROM facility_accepted_materials fam
  INNER JOIN materials m ON m.material_id = fam.material_id
  WHERE m.material_class IN ('PRECIOUS_METAL', 'BATTERY_CHEMISTRY')
)
AND rf.processing_capacity_tons_month > ALL (
  SELECT rf2.processing_capacity_tons_month
  FROM recycling_facilities rf2
  WHERE rf2.facility_type = 'POLYMER_RECYCLER'
)
ORDER BY rf.processing_capacity_tons_month DESC;

-- ----------------------------------------------------------------------------
-- Q12: Recursive CTE #1: Full Multi-Level E-Waste Category Hierarchy & Rollup
-- Objective: Traverse the self-referencing e_waste_categories tree from root domains down to leaf categories, building breadcrumb paths and depth levels.
-- Concepts: WITH RECURSIVE, Tree Traversal, Path Materialization
-- ----------------------------------------------------------------------------
WITH RECURSIVE category_tree AS (
  SELECT
    c.category_id,
    c.category_code,
    c.name,
    c.parent_category_id,
    1 AS hierarchy_depth,
    c.name::TEXT AS lineage_path
  FROM e_waste_categories c
  WHERE c.parent_category_id IS NULL

  UNION ALL

  SELECT
    child.category_id,
    child.category_code,
    child.name,
    child.parent_category_id,
    ct.hierarchy_depth + 1,
    ct.lineage_path || ' -> ' || child.name
  FROM e_waste_categories child
  INNER JOIN category_tree ct ON child.parent_category_id = ct.category_id
)
SELECT
  ct.hierarchy_depth,
  ct.category_code,
  ct.lineage_path,
  COUNT(d.device_id) AS direct_devices_count
FROM category_tree ct
LEFT JOIN devices d ON d.category_id = ct.category_id
GROUP BY ct.hierarchy_depth, ct.category_code, ct.lineage_path
ORDER BY ct.lineage_path;

-- ----------------------------------------------------------------------------
-- Q13: Recursive CTE #2: Component Sub-Assembly & Circular Cross-Device Reuse Lineage
-- Objective: Trace extracted parent components down through disassembled child sub-components AND link each component to its final reuse target device, smelter, or TSDF manifest.
-- Concepts: WITH RECURSIVE, Component-Level Traceability, Sub-Assembly Disassembly Tree
-- ----------------------------------------------------------------------------
WITH RECURSIVE component_lineage AS (
  SELECT
    rc.recovered_component_id,
    rc.component_uid,
    rc.source_device_id,
    rc.component_type_id,
    rc.parent_recovered_component_id,
    rc.current_status,
    rc.destination_type,
    rc.installed_in_repair_id,
    rc.recycling_facility_id,
    1 AS disassembly_level,
    rc.component_uid::TEXT AS component_chain
  FROM recovered_components rc
  WHERE rc.parent_recovered_component_id IS NULL

  UNION ALL

  SELECT
    sub.recovered_component_id,
    sub.component_uid,
    sub.source_device_id,
    sub.component_type_id,
    sub.parent_recovered_component_id,
    sub.current_status,
    sub.destination_type,
    sub.installed_in_repair_id,
    sub.recycling_facility_id,
    cl.disassembly_level + 1,
    cl.component_chain || ' -> ' || sub.component_uid
  FROM recovered_components sub
  INNER JOIN component_lineage cl
    ON sub.parent_recovered_component_id = cl.recovered_component_id
)
SELECT
  sd.tracking_number AS origin_device,
  cl.disassembly_level,
  cl.component_chain,
  cc.name AS component_type,
  cl.destination_type,
  cl.current_status,
  COALESCE(
    'Reused in ' || td.tracking_number,
    'Facility: ' || rf.name,
    'Stock / Secondary Resale'
  ) AS final_traceable_destination
FROM component_lineage cl
INNER JOIN devices sd            ON sd.device_id = cl.source_device_id
INNER JOIN component_catalog cc  ON cc.component_type_id = cl.component_type_id
LEFT  JOIN repair_records rep    ON rep.repair_id = cl.installed_in_repair_id
LEFT  JOIN devices td            ON td.device_id = rep.device_id
LEFT  JOIN recycling_facilities rf ON rf.facility_id = cl.recycling_facility_id
ORDER BY sd.tracking_number ASC, cl.component_chain ASC
LIMIT 25;

-- ----------------------------------------------------------------------------
-- Q14: Multi-Stage CTE: Theoretical vs Actual Material Recovery Yield Efficiency
-- Objective: Compare expected raw material mass (from component_material_composition) against actual recovered_weight_kg for dismantled & recycled devices.
-- Concepts: Chained CTEs, M:N Junction Math, CASE Classification
-- ----------------------------------------------------------------------------
WITH expected_device_yield AS (
  SELECT
    rc.source_device_id,
    ROUND(SUM(rc.weight_kg * (cmc.typical_mass_pct / 100.0))::NUMERIC, 4) AS expected_recoverable_kg
  FROM recovered_components rc
  INNER JOIN component_material_composition cmc
    ON cmc.component_type_id = rc.component_type_id
  WHERE rc.parent_recovered_component_id IS NULL
  GROUP BY rc.source_device_id
),
actual_device_yield AS (
  SELECT
    source_device_id,
    ROUND(SUM(recovered_weight_kg)::NUMERIC, 4) AS actual_recovered_kg
  FROM material_recovery_records
  GROUP BY source_device_id
)
SELECT
  d.tracking_number,
  d.brand || ' ' || d.model_name AS device_name,
  d.weight_kg AS device_mass_kg,
  ey.expected_recoverable_kg,
  ay.actual_recovered_kg,
  CASE
    WHEN ay.actual_recovered_kg >= ey.expected_recoverable_kg THEN 'HIGH_EXTRACTION_YIELD'
    WHEN ay.actual_recovered_kg >= ey.expected_recoverable_kg * 0.70 THEN 'NOMINAL_YIELD'
    ELSE 'PARTIAL_COMPONENT_REUSE_OFFSET'
  END AS yield_band
FROM devices d
INNER JOIN expected_device_yield ey ON ey.source_device_id = d.device_id
INNER JOIN actual_device_yield ay   ON ay.source_device_id = d.device_id
ORDER BY ay.actual_recovered_kg DESC
LIMIT 15;

-- ----------------------------------------------------------------------------
-- Q15: Window Functions (LAG & LEAD): Lifecycle Stage Dwell-Time Bottleneck Analysis
-- Objective: Compute exact hours spent in each lifecycle stage per device using LAG and preview the next transition using LEAD.
-- Concepts: LAG(), LEAD(), PARTITION BY, Epoch Duration Math
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  le.from_status,
  le.to_status AS entered_status,
  le.occurred_at,
  LAG(le.occurred_at) OVER (
    PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
  ) AS previous_event_at,
  ROUND(
    EXTRACT(EPOCH FROM (
      le.occurred_at - LAG(le.occurred_at) OVER (
        PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
      )
    )) / 3600.0,
    2
  ) AS hours_since_prev_stage,
  LEAD(le.to_status) OVER (
    PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
  ) AS subsequent_status
FROM lifecycle_events le
INNER JOIN devices d ON d.device_id = le.device_id
WHERE d.tracking_number IN ('RLP-2026-00001', 'RLP-2026-00002', 'RLP-2026-00005')
ORDER BY d.tracking_number, le.occurred_at ASC, le.event_id ASC;

-- ----------------------------------------------------------------------------
-- Q16: Window Functions (RANK & DENSE_RANK): Recycling Facility Leaderboard
-- Objective: Rank certified recycling facilities by total mass recovered and calculate each facility’s percentage share of total recovered materials.
-- Concepts: RANK(), DENSE_RANK(), SUM() OVER () Share %
-- ----------------------------------------------------------------------------
WITH fac_totals AS (
  SELECT
    rf.facility_code,
    rf.name AS facility_name,
    rf.facility_type,
    COALESCE(SUM(mrr.recovered_weight_kg), 0) AS recovered_kg
  FROM recycling_facilities rf
  LEFT JOIN material_recovery_records mrr ON mrr.facility_id = rf.facility_id
  GROUP BY rf.facility_id, rf.facility_code, rf.name, rf.facility_type
)
SELECT
  facility_code,
  facility_name,
  facility_type,
  ROUND(recovered_kg::NUMERIC, 3) AS recovered_kg,
  RANK() OVER (ORDER BY recovered_kg DESC) AS volume_rank,
  DENSE_RANK() OVER (ORDER BY recovered_kg DESC) AS dense_volume_rank,
  ROUND((100.0 * recovered_kg / NULLIF(SUM(recovered_kg) OVER (), 0))::NUMERIC, 2) AS share_of_total_pct
FROM fac_totals
ORDER BY volume_rank ASC;

-- ----------------------------------------------------------------------------
-- Q17: Window Function (ROW_NUMBER + PARTITION BY): Top Recovered Component Per Dismantled Device
-- Objective: Extract the single highest-value harvested component from every dismantled electronic device.
-- Concepts: ROW_NUMBER(), PARTITION BY, Top-N Per Group
-- ----------------------------------------------------------------------------
WITH ranked_components AS (
  SELECT
    sd.tracking_number,
    sd.brand || ' ' || sd.model_name AS source_device,
    rc.component_uid,
    cc.name AS component_type,
    rc.condition_status,
    rc.estimated_value_inr,
    ROW_NUMBER() OVER (
      PARTITION BY rc.source_device_id
      ORDER BY rc.estimated_value_inr DESC, rc.recovered_component_id ASC
    ) AS rn
  FROM recovered_components rc
  INNER JOIN devices sd           ON sd.device_id = rc.source_device_id
  INNER JOIN component_catalog cc ON cc.component_type_id = rc.component_type_id
)
SELECT
  tracking_number,
  source_device,
  component_uid,
  component_type,
  condition_status,
  estimated_value_inr
FROM ranked_components
WHERE rn = 1
ORDER BY estimated_value_inr DESC
LIMIT 15;

-- ----------------------------------------------------------------------------
-- Q18: Cumulative Window Sum: Monthly Running E-Waste Collection Mass & MoM Growth
-- Objective: Calculate monthly e-waste collection mass alongside cumulative year-to-date tonnage and month-over-month weight delta.
-- Concepts: Cumulative SUM() OVER (ORDER BY), LAG() Month-over-Month
-- ----------------------------------------------------------------------------
WITH monthly_intake AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM') AS collection_month,
    COUNT(d.device_id) AS devices_intake,
    ROUND(SUM(d.weight_kg)::NUMERIC, 2) AS monthly_kg
  FROM collection_batches cb
  INNER JOIN devices d ON d.collection_id = cb.collection_id
  GROUP BY TO_CHAR(DATE_TRUNC('month', cb.collection_date), 'YYYY-MM')
)
SELECT
  collection_month,
  devices_intake,
  monthly_kg,
  ROUND(SUM(monthly_kg) OVER (ORDER BY collection_month ASC)::NUMERIC, 2) AS cumulative_ytd_kg,
  ROUND((monthly_kg - LAG(monthly_kg) OVER (ORDER BY collection_month ASC))::NUMERIC, 2) AS mom_delta_kg
FROM monthly_intake
ORDER BY collection_month ASC;

-- ----------------------------------------------------------------------------
-- Q19: CASE Expressions: Refurbishment Economic ROI & Net Value Gain Analysis
-- Objective: Evaluate completed device repairs by comparing repair cost against post-refurbishment resale/grant valuation.
-- Concepts: CASE WHEN, Financial Margin Calculation, JOIN
-- ----------------------------------------------------------------------------
SELECT
  r.ticket_number,
  d.tracking_number,
  d.brand || ' ' || d.model_name AS device_name,
  r.actual_cost_inr,
  r.resale_value_inr,
  ROUND((r.resale_value_inr - r.actual_cost_inr)::NUMERIC, 2) AS net_circular_value_inr,
  CASE
    WHEN r.actual_cost_inr = 0 THEN 'ZERO_COST_WARRANTY'
    WHEN (r.resale_value_inr / r.actual_cost_inr) >= 10 THEN 'EXCEPTIONAL_ROI'
    WHEN (r.resale_value_inr / r.actual_cost_inr) >= 5  THEN 'HIGH_ROI'
    ELSE 'MODERATE_SOCIAL_IMPACT'
  END AS economic_tier,
  r.reuse_channel
FROM repair_records r
INNER JOIN devices d ON d.device_id = r.device_id
WHERE r.repair_status = 'COMPLETED'
ORDER BY net_circular_value_inr DESC;

-- ----------------------------------------------------------------------------
-- Q20: Database View Query: Executive Circular Economy KPIs (Zero Double-Counting)
-- Objective: Query the database view vw_kpi_executive_summary demonstrating non-overlapping device vs component recycling KPIs.
-- Concepts: VIEW (vw_kpi_executive_summary), FILTER Clause KPIs
-- ----------------------------------------------------------------------------
SELECT
  total_devices_collected,
  devices_under_inspection,
  devices_repaired,
  devices_refurbished,
  devices_dismantled,
  total_devices_recycled,
  total_devices_disposed,
  total_recovered_components,
  total_material_recovered_kg,
  recycling_rate_pct,
  circular_diversion_rate_pct,
  repair_success_rate_pct
FROM vw_kpi_executive_summary;

-- ----------------------------------------------------------------------------
-- Q21: Materialized View Query: Pre-Aggregated Monthly Category Matrix
-- Objective: Read pre-computed monthly collection and circular recovery rollups from mv_monthly_ewaste_summary.
-- Concepts: MATERIALIZED VIEW (mv_monthly_ewaste_summary), Unique Concurrent Index
-- ----------------------------------------------------------------------------
SELECT
  month_bucket,
  category_name,
  devices_collected,
  total_collected_kg,
  devices_reused_or_refurbished,
  devices_recycled,
  devices_disposed
FROM mv_monthly_ewaste_summary
ORDER BY month_bucket DESC, total_collected_kg DESC
LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q22: Stored Table Function #1: Device Mass-Balance & CO2 Recovery Calculator
-- Objective: Invoke fn_calculate_device_recovery_metrics across flagship dismantled/recycled devices using CROSS JOIN LATERAL.
-- Concepts: Stored SQL Function (fn_calculate_device_recovery_metrics), LATERAL Function Call
-- ----------------------------------------------------------------------------
SELECT
  m.tracking_number,
  m.device_weight_kg,
  m.extracted_components_count,
  m.reusable_components_count,
  m.reusable_components_kg,
  m.materials_recovered_kg,
  m.hazardous_disposed_kg,
  m.mass_accounted_pct,
  m.total_value_recovered_inr,
  m.estimated_co2_saved_kg
FROM devices d
CROSS JOIN LATERAL fn_calculate_device_recovery_metrics(d.device_id) m
WHERE d.tracking_number IN ('RLP-2026-00002', 'RLP-2026-00003', 'RLP-2026-00004', 'RLP-2026-00005')
ORDER BY m.tracking_number;

-- ----------------------------------------------------------------------------
-- Q23: Stored PL/pgSQL Function #2: State-Machine Valid Next Transitions & Blockers
-- Objective: Inspect dynamically computed allowed next statuses and evidence readiness for an active in-pipeline device.
-- Concepts: PL/pgSQL Function (fn_get_allowed_next_statuses), State Machine Introspection
-- ----------------------------------------------------------------------------
SELECT
  d.tracking_number,
  d.current_status,
  ns.to_status AS allowed_next_status,
  ns.allowed_roles,
  ns.prerequisite_met,
  COALESCE(ns.blocking_reason, 'Ready for immediate transition') AS readiness_note
FROM devices d
CROSS JOIN LATERAL fn_get_allowed_next_statuses(d.device_id) ns
WHERE d.current_status IN ('UNDER_INSPECTION', 'UNDER_REPAIR', 'UNDER_DISMANTLING', 'DISMANTLED')
ORDER BY d.tracking_number, ns.to_status
LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q24: JSONB Audit Trail Inspection: Trigger-Generated Row Change Diffs
-- Objective: Query JSONB before/after snapshots captured automatically by trg_audit_devices during status updates.
-- Concepts: JSONB Operators (->>), Audit Trigger Verification
-- ----------------------------------------------------------------------------
SELECT
  al.log_id,
  al.table_name,
  al.action_type,
  u.full_name AS actor_name,
  al.old_payload ->> 'current_status' AS previous_status,
  al.new_payload ->> 'current_status' AS updated_status,
  al.new_payload ->> 'tracking_number' AS tracking_number,
  al.created_at
FROM audit_logs al
LEFT JOIN users u ON u.user_id = al.actor_user_id
WHERE al.table_name = 'devices'
  AND al.action_type = 'UPDATE'
  AND (al.old_payload ->> 'current_status') IS DISTINCT FROM (al.new_payload ->> 'current_status')
ORDER BY al.log_id DESC
LIMIT 15;

-- ----------------------------------------------------------------------------
-- Q25: EXPLAIN ANALYZE #1: Composite Index Scan on Chronological Lifecycle Timeline
-- Objective: Demonstrate PostgreSQL execution plan leveraging idx_lifecycle_events_device_occurred without an expensive sort.
-- Concepts: EXPLAIN (ANALYZE, BUFFERS), Composite Index Scan (idx_lifecycle_events_device_occurred)
-- ----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT event_id, from_status, to_status, occurred_at, notes
FROM lifecycle_events
WHERE device_id = 2
ORDER BY occurred_at ASC, event_id ASC;

-- ----------------------------------------------------------------------------
-- Q26: EXPLAIN ANALYZE #2: Partial Index Lookup on Reusable Spare-Parts Inventory
-- Objective: Inspect execution plan for querying working spare components ready for bench repairs.
-- Concepts: EXPLAIN (ANALYZE, BUFFERS), Partial Index (idx_components_reusable_stock_partial)
-- ----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT component_uid, component_type_id, estimated_value_inr
FROM recovered_components
WHERE current_status = 'IN_INVENTORY'
  AND condition_status IN ('WORKING', 'REPAIRABLE')
  AND component_type_id = 1
ORDER BY estimated_value_inr DESC;

