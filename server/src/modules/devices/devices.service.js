const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function resolveDeviceId(identifier, db = { query }) {
  const str = String(identifier).trim();
  const isNum = /^\d+$/.test(str);
  const res = isNum
    ? await db.query('SELECT device_id, tracking_number FROM devices WHERE device_id = $1', [Number(str)])
    : await db.query('SELECT device_id, tracking_number FROM devices WHERE UPPER(tracking_number) = UPPER($1)', [str]);

  if (res.rowCount === 0) {
    throw new ApiError(404, `Device '${identifier}' not found.`, 'DEVICE_NOT_FOUND');
  }
  return res.rows[0].device_id;
}

async function listDevices(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    const idx = params.length;
    conditions.push(
      `(tracking_number ILIKE $${idx} OR brand ILIKE $${idx} OR model_name ILIKE $${idx} OR COALESCE(serial_number, '') ILIKE $${idx} OR source_organization_name ILIKE $${idx})`
    );
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`current_status = $${params.length}`);
  }
  if (filters.category_id) {
    params.push(Number(filters.category_id));
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.center_id) {
    params.push(Number(filters.center_id));
    conditions.push(`current_center_id = $${params.length}`);
  }
  if (filters.hazardous === 'true' || filters.hazardous === 'false') {
    params.push(filters.hazardous === 'true');
    conditions.push(`contains_hazardous_materials = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(parseInt(filters.limit || '100', 10), 1), 250);
  params.push(limit);

  const sql = `
    SELECT *
      FROM vw_device_master_overview
      ${whereClause}
     ORDER BY device_id DESC
     LIMIT $${params.length};
  `;
  const res = await query(sql, params);
  return res.rows;
}

async function registerDevice(payload, actor, clientIp) {
  const {
    tracking_number = null,
    collection_id = null,
    create_new_batch = false,
    center_id,
    source_organization_id = null,
    source_type = 'CORPORATE_BULK',
    collection_date = null,
    category_id,
    brand,
    model_name,
    serial_number = null,
    manufacture_year = null,
    weight_kg,
    estimated_value_inr = 0,
    condition_grade = null,
    contains_hazardous_materials = false,
    source_notes = null,
    auto_collect = true,
  } = payload;

  if (!category_id || !brand || !model_name || !weight_kg) {
    throw new ApiError(
      400,
      'category_id, brand, model_name, and weight_kg are required.',
      'VALIDATION_ERROR'
    );
  }

  return withTransaction(
    async (client) => {
      let targetCollectionId = collection_id ? Number(collection_id) : null;
      let targetCenterId = center_id ? Number(center_id) : null;

      if (create_new_batch || !targetCollectionId) {
        if (!targetCenterId) {
          throw new ApiError(
            400,
            'center_id is required when creating a new collection intake batch.',
            'VALIDATION_ERROR'
          );
        }
        const batchSeqRes = await client.query(
          'SELECT COALESCE(MAX(collection_id), 0) + 1 AS next_id FROM collection_batches'
        );
        const batchNumber = `COL-2026-${String(batchSeqRes.rows[0].next_id).padStart(4, '0')}`;
        const batchRes = await client.query(
          `INSERT INTO collection_batches
            (batch_number, center_id, source_organization_id, source_type, collected_by_user_id,
             collection_date, declared_weight_kg, pickup_notes)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6::DATE, CURRENT_DATE),$7,$8)
           RETURNING collection_id, center_id`,
          [
            batchNumber,
            targetCenterId,
            source_organization_id || null,
            source_type,
            actor.user_id,
            collection_date || null,
            weight_kg,
            source_notes || 'Registered during device intake workflow',
          ]
        );
        targetCollectionId = batchRes.rows[0].collection_id;
        targetCenterId = batchRes.rows[0].center_id;
      } else {
        const existingBatch = await client.query(
          'SELECT collection_id, center_id FROM collection_batches WHERE collection_id = $1',
          [targetCollectionId]
        );
        if (existingBatch.rowCount === 0) {
          throw new ApiError(400, `Collection batch ${targetCollectionId} does not exist.`, 'INVALID_BATCH');
        }
        if (!targetCenterId) {
          targetCenterId = existingBatch.rows[0].center_id;
        }
      }

      let finalTracking = tracking_number ? String(tracking_number).trim() : null;
      if (!finalTracking) {
        const seqRes = await client.query(
          'SELECT COALESCE(MAX(device_id), 0) + 1 AS next_seq FROM devices'
        );
        finalTracking = `RLP-2026-${String(seqRes.rows[0].next_seq).padStart(5, '0')}`;
      }

      await setTransitionContext(client, {
        userId: actor.user_id,
        referenceEntity: 'REGISTRATION',
        referenceId: targetCollectionId,
        notes: `Device registered under collection batch #${targetCollectionId}`,
      });

      const devRes = await client.query(
        `INSERT INTO devices
          (tracking_number, collection_id, category_id, current_center_id, brand, model_name,
           serial_number, manufacture_year, weight_kg, estimated_value_inr, current_status,
           condition_grade, contains_hazardous_materials, source_notes, registered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REGISTERED',$11,$12,$13,$14)
         RETURNING *`,
        [
          finalTracking,
          targetCollectionId,
          Number(category_id),
          targetCenterId,
          String(brand).trim(),
          String(model_name).trim(),
          serial_number ? String(serial_number).trim() : null,
          manufacture_year ? Number(manufacture_year) : null,
          Number(weight_kg),
          Number(estimated_value_inr || 0),
          condition_grade || null,
          Boolean(contains_hazardous_materials),
          source_notes || null,
          actor.user_id,
        ]
      );

      let device = devRes.rows[0];

      if (auto_collect) {
        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'COLLECTION',
          referenceId: targetCollectionId,
          notes: 'Physically received and verified at collection hub during registration',
        });
        const upd = await client.query(
          `UPDATE devices SET current_status = 'COLLECTED' WHERE device_id = $1 RETURNING *`,
          [device.device_id]
        );
        device = upd.rows[0];
      }

      return device;
    },
    { userId: actor.user_id, clientIp }
  );
}

async function transitionDeviceStatus(identifier, { to_status, notes }, actor, clientIp) {
  if (!to_status) {
    throw new ApiError(400, 'Target to_status is required.', 'VALIDATION_ERROR');
  }

  return withTransaction(
    async (client) => {
      const deviceId = await resolveDeviceId(identifier, client);
      const curRes = await client.query(
        'SELECT device_id, tracking_number, current_status FROM devices WHERE device_id = $1 FOR UPDATE',
        [deviceId]
      );
      const device = curRes.rows[0];

      // Check role authorization in lifecycle_transition_rules if transition exists
      const ruleRes = await client.query(
        `SELECT allowed_roles
           FROM lifecycle_transition_rules
          WHERE from_status = $1 AND to_status = $2`,
        [device.current_status, to_status]
      );

      if (ruleRes.rowCount > 0) {
        const allowedRoles = ruleRes.rows[0].allowed_roles || [];
        if (!allowedRoles.includes(actor.role)) {
          throw new ApiError(
            403,
            `Role '${actor.role}' cannot transition device from ${device.current_status} to ${to_status}. Allowed: ${allowedRoles.join(', ')}`,
            'FORBIDDEN_TRANSITION_ROLE'
          );
        }
      }

      await setTransitionContext(client, {
        userId: actor.user_id,
        referenceEntity: 'MANUAL_TRANSITION',
        notes: notes || `Status advanced to ${to_status} by ${actor.full_name}`,
      });

      // Trigger trg_validate_device_lifecycle_transition validates state machine & prerequisites!
      const updRes = await client.query(
        'UPDATE devices SET current_status = $1 WHERE device_id = $2 RETURNING *',
        [to_status, deviceId]
      );
      return updRes.rows[0];
    },
    { userId: actor.user_id, clientIp }
  );
}

async function transferDevice(identifier, payload, actor, clientIp) {
  const { to_center_id, vehicle_manifest = 'INTERNAL-EV-SHUTTLE', notes = null } = payload;
  if (!to_center_id) {
    throw new ApiError(400, 'to_center_id is required.', 'VALIDATION_ERROR');
  }

  return withTransaction(
    async (client) => {
      const deviceId = await resolveDeviceId(identifier, client);
      const procRes = await client.query(
        'CALL sp_transfer_device_between_centers($1, $2, $3, $4, $5, NULL)',
        [deviceId, Number(to_center_id), actor.user_id, vehicle_manifest, notes]
      );
      const transferId = procRes.rows[0] ? procRes.rows[0].p_transfer_id : null;
      const trf = await client.query('SELECT * FROM device_transfers WHERE transfer_id = $1', [transferId]);
      return trf.rows[0];
    },
    { userId: actor.user_id, clientIp }
  );
}

/**
 * Workflow 7: Complete Chronological Traceability & Recursive Component Lineage
 */
async function getFullDeviceTraceability(identifier) {
  const deviceId = await resolveDeviceId(identifier);

  const [
    overviewRes,
    allowedNextRes,
    recoveryMetricsRes,
    timelineRes,
    inspectionsRes,
    repairsRes,
    installedCircularPartsRes,
    dismantlingRes,
    recursiveComponentsRes,
    materialsRes,
    disposalsRes,
    transfersRes,
  ] = await Promise.all([
    query('SELECT * FROM vw_device_master_overview WHERE device_id = $1', [deviceId]),
    query('SELECT * FROM fn_get_allowed_next_statuses($1)', [deviceId]),
    query('SELECT * FROM fn_calculate_device_recovery_metrics($1)', [deviceId]),
    query(
      `SELECT
         le.event_id,
         le.from_status,
         le.to_status,
         le.reference_entity,
         le.reference_id,
         le.notes,
         le.occurred_at,
         u.full_name AS actor_name,
         u.role AS actor_role,
         cc.name AS center_name,
         ROUND(
           EXTRACT(EPOCH FROM (
             le.occurred_at - LAG(le.occurred_at) OVER (
               PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
             )
           )) / 3600.0,
           2
         ) AS hours_in_previous_stage,
         LEAD(le.to_status) OVER (
           PARTITION BY le.device_id ORDER BY le.occurred_at ASC, le.event_id ASC
         ) AS next_status
       FROM lifecycle_events le
       INNER JOIN users u ON u.user_id = le.changed_by
       LEFT JOIN collection_centers cc ON cc.center_id = le.center_id
       WHERE le.device_id = $1
       ORDER BY le.occurred_at ASC, le.event_id ASC`,
      [deviceId]
    ),
    query(
      `SELECT
         i.*,
         u.full_name AS inspector_name,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'result_id', icr.result_id,
                 'subsystem_name', icr.subsystem_name,
                 'check_status', icr.check_status,
                 'measured_metric', icr.measured_metric,
                 'remarks', icr.remarks
               ) ORDER BY icr.result_id
             )
             FROM inspection_check_results icr
             WHERE icr.inspection_id = i.inspection_id
           ),
           '[]'::json
         ) AS check_results
       FROM inspections i
       INNER JOIN users u ON u.user_id = i.inspector_id
       WHERE i.device_id = $1
       ORDER BY i.inspected_at DESC`,
      [deviceId]
    ),
    query(
      `SELECT r.*, u.full_name AS technician_name, o.name AS reuse_organization_name
         FROM repair_records r
         INNER JOIN users u ON u.user_id = r.technician_id
         LEFT JOIN organizations o ON o.organization_id = r.reuse_destination_org_id
        WHERE r.device_id = $1
        ORDER BY r.started_at DESC`,
      [deviceId]
    ),
    // Components harvested from OTHER dismantled devices that were installed into THIS device!
    query(
      `SELECT vcl.*
         FROM vw_component_full_lineage vcl
        WHERE vcl.target_reuse_device_id = $1
        ORDER BY vcl.recovered_at DESC`,
      [deviceId]
    ),
    query(
      `SELECT dr.*, u.full_name AS operator_name, cc.name AS center_name
         FROM dismantling_records dr
         INNER JOIN users u ON u.user_id = dr.operator_id
         INNER JOIN collection_centers cc ON cc.center_id = dr.center_id
        WHERE dr.device_id = $1`,
      [deviceId]
    ),
    // Recursive CTE tracing components & child sub-components extracted from THIS device!
    query(
      `WITH RECURSIVE comp_tree AS (
         SELECT
           rc.recovered_component_id,
           rc.component_uid,
           rc.parent_recovered_component_id,
           rc.component_type_id,
           rc.serial_or_part_no,
           rc.condition_status,
           rc.weight_kg,
           rc.estimated_value_inr,
           rc.current_status,
           rc.destination_type,
           rc.installed_in_repair_id,
           rc.recycling_facility_id,
           rc.recovered_at,
           rc.destination_notes,
           1 AS tree_depth,
           rc.component_uid::TEXT AS tree_path
         FROM recovered_components rc
         WHERE rc.source_device_id = $1
           AND rc.parent_recovered_component_id IS NULL

         UNION ALL

         SELECT
           sub.recovered_component_id,
           sub.component_uid,
           sub.parent_recovered_component_id,
           sub.component_type_id,
           sub.serial_or_part_no,
           sub.condition_status,
           sub.weight_kg,
           sub.estimated_value_inr,
           sub.current_status,
           sub.destination_type,
           sub.installed_in_repair_id,
           sub.recycling_facility_id,
           sub.recovered_at,
           sub.destination_notes,
           ct.tree_depth + 1,
           ct.tree_path || ' ↳ ' || sub.component_uid
         FROM recovered_components sub
         INNER JOIN comp_tree ct ON sub.parent_recovered_component_id = ct.recovered_component_id
       )
       SELECT
         ct.*,
         cat.name AS component_type_name,
         cat.component_group,
         rep.ticket_number AS installed_in_repair_ticket,
         td.tracking_number AS target_reuse_device_tracking_no,
         rf.name AS recycling_facility_name,
         disp.manifest_number AS hazardous_manifest_number
       FROM comp_tree ct
       INNER JOIN component_catalog cat ON cat.component_type_id = ct.component_type_id
       LEFT JOIN repair_records rep ON rep.repair_id = ct.installed_in_repair_id
       LEFT JOIN devices td ON td.device_id = rep.device_id
       LEFT JOIN recycling_facilities rf ON rf.facility_id = ct.recycling_facility_id
       LEFT JOIN disposal_records disp ON disp.recovered_component_id = ct.recovered_component_id
       ORDER BY ct.tree_path ASC`,
      [deviceId]
    ),
    query(
      `SELECT mrr.*, m.name AS material_name, m.material_class, m.is_hazardous,
              m.co2_saved_per_kg, m.market_value_per_kg_inr,
              rf.name AS facility_name, rf.facility_code,
              rc.component_uid, u.full_name AS recorded_by_name
         FROM material_recovery_records mrr
         INNER JOIN materials m ON m.material_id = mrr.material_id
         INNER JOIN recycling_facilities rf ON rf.facility_id = mrr.facility_id
         INNER JOIN users u ON u.user_id = mrr.recorded_by
         LEFT JOIN recovered_components rc ON rc.recovered_component_id = mrr.recovered_component_id
        WHERE mrr.source_device_id = $1
        ORDER BY mrr.recovery_date DESC, mrr.recovery_id DESC`,
      [deviceId]
    ),
    query(
      `SELECT dr.*, rf.name AS facility_name, rf.certification_number,
              rc.component_uid, u.full_name AS authorized_by_name
         FROM disposal_records dr
         INNER JOIN recycling_facilities rf ON rf.facility_id = dr.facility_id
         INNER JOIN users u ON u.user_id = dr.authorized_by
         LEFT JOIN recovered_components rc ON rc.recovered_component_id = dr.recovered_component_id
        WHERE dr.device_id = $1
        ORDER BY dr.disposed_at DESC`,
      [deviceId]
    ),
    query(
      `SELECT dt.*, fc.name AS from_center_name, tc.name AS to_center_name,
              iu.full_name AS initiated_by_name
         FROM device_transfers dt
         INNER JOIN collection_centers fc ON fc.center_id = dt.from_center_id
         INNER JOIN collection_centers tc ON tc.center_id = dt.to_center_id
         INNER JOIN users iu ON iu.user_id = dt.initiated_by
        WHERE dt.device_id = $1
        ORDER BY dt.transferred_at DESC`,
      [deviceId]
    ),
  ]);

  return {
    device: overviewRes.rows[0],
    allowed_next_statuses: allowedNextRes.rows,
    recovery_metrics: recoveryMetricsRes.rows[0] || null,
    lifecycle_timeline: timelineRes.rows,
    inspections: inspectionsRes.rows,
    repairs: repairsRes.rows,
    installed_circular_components: installedCircularPartsRes.rows,
    dismantling: dismantlingRes.rows[0] || null,
    recovered_components_lineage: recursiveComponentsRes.rows,
    material_recoveries: materialsRes.rows,
    disposal_records: disposalsRes.rows,
    transfers: transfersRes.rows,
  };
}

module.exports = {
  resolveDeviceId,
  listDevices,
  registerDevice,
  transitionDeviceStatus,
  transferDevice,
  getFullDeviceTraceability,
};
