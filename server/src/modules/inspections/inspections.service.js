const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listInspections() {
  const [historyRes, queueRes] = await Promise.all([
    query(`
      SELECT
        i.*,
        d.tracking_number,
        d.brand,
        d.model_name,
        d.current_status AS device_current_status,
        u.full_name AS inspector_name,
        (SELECT COUNT(*) FROM inspection_check_results icr WHERE icr.inspection_id = i.inspection_id) AS checks_count
      FROM inspections i
      INNER JOIN devices d ON d.device_id = i.device_id
      INNER JOIN users u   ON u.user_id   = i.inspector_id
      ORDER BY i.inspected_at DESC
      LIMIT 100;
    `),
    query(`
      SELECT device_id, tracking_number, brand, model_name, weight_kg,
             current_status, contains_hazardous_materials, category_name, current_center_name
        FROM vw_device_master_overview
       WHERE current_status IN ('COLLECTED', 'UNDER_INSPECTION')
       ORDER BY current_status DESC, device_id ASC;
    `),
  ]);

  return {
    inspections: historyRes.rows,
    pending_queue: queueRes.rows,
  };
}

async function createInspection(payload, actor, clientIp) {
  const {
    device_id,
    physical_condition,
    functional_status,
    power_on_passed = false,
    battery_health_pct = null,
    hazard_detected = false,
    hazard_notes = null,
    overall_grade,
    recommended_pathway,
    inspector_summary,
    check_results = [],
    auto_advance_status = true,
  } = payload;

  if (!device_id || !physical_condition || !functional_status || !overall_grade || !recommended_pathway || !inspector_summary) {
    throw new ApiError(
      400,
      'device_id, physical_condition, functional_status, overall_grade, recommended_pathway, and inspector_summary are required.',
      'VALIDATION_ERROR'
    );
  }

  return withTransaction(
    async (client) => {
      // Lock target device row to prevent concurrent conflicting inspection transitions
      const devRes = await client.query(
        'SELECT * FROM devices WHERE device_id = $1 FOR UPDATE',
        [Number(device_id)]
      );
      if (devRes.rowCount === 0) {
        throw new ApiError(404, `Device ${device_id} not found.`, 'DEVICE_NOT_FOUND');
      }
      const device = devRes.rows[0];

      if (!['COLLECTED', 'UNDER_INSPECTION'].includes(device.current_status)) {
        throw new ApiError(
          400,
          `Device ${device.tracking_number} is in status '${device.current_status}' and cannot be inspected unless COLLECTED or UNDER_INSPECTION.`,
          'INVALID_INSPECTION_STATE'
        );
      }

      if (device.current_status === 'COLLECTED') {
        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'INSPECTION_QUEUE',
          notes: `Inducted onto diagnostic bench by ${actor.full_name}`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'UNDER_INSPECTION' WHERE device_id = $1`,
          [device.device_id]
        );
      }

      const seqRes = await client.query('SELECT COALESCE(MAX(inspection_id), 0) + 1 AS next_id FROM inspections');
      const inspectionCode = `INSP-2026-${String(seqRes.rows[0].next_id).padStart(4, '0')}`;

      const inspRes = await client.query(
        `INSERT INTO inspections
          (inspection_code, device_id, inspector_id, physical_condition, functional_status,
           power_on_passed, battery_health_pct, hazard_detected, hazard_notes,
           overall_grade, recommended_pathway, inspector_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          inspectionCode,
          device.device_id,
          actor.user_id,
          physical_condition,
          functional_status,
          Boolean(power_on_passed),
          battery_health_pct !== '' && battery_health_pct !== null ? Number(battery_health_pct) : null,
          Boolean(hazard_detected),
          hazard_notes || null,
          overall_grade,
          recommended_pathway,
          inspector_summary,
        ]
      );
      const inspection = inspRes.rows[0];

      // Demonstrate PostgreSQL SAVEPOINT for granular subsystem checklist insertion
      await client.query('SAVEPOINT sp_inspection_checklist');
      try {
        const items = Array.isArray(check_results) && check_results.length > 0
          ? check_results
          : [
              {
                subsystem_name: 'Primary Power & Logic Board',
                check_status: power_on_passed ? 'PASS' : 'FAIL',
                measured_metric: power_on_passed ? 'Nominal boot rail' : 'Fault detected',
                remarks: 'Automated bench power verification',
              },
              {
                subsystem_name: 'Enclosure & Hazard Screening',
                check_status: hazard_detected ? 'HAZARDOUS' : 'PASS',
                measured_metric: overall_grade,
                remarks: hazard_notes || 'No chemical/thermal leak observed',
              },
            ];

        for (const item of items) {
          if (!item.subsystem_name || !item.check_status) continue;
          await client.query(
            `INSERT INTO inspection_check_results
              (inspection_id, subsystem_name, check_status, measured_metric, remarks)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              inspection.inspection_id,
              String(item.subsystem_name).trim(),
              item.check_status,
              item.measured_metric || null,
              item.remarks || null,
            ]
          );
        }
        await client.query('RELEASE SAVEPOINT sp_inspection_checklist');
      } catch (checkErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_inspection_checklist');
        throw checkErr;
      }

      // Sync condition_grade and hazard flag onto devices
      await client.query(
        `UPDATE devices
            SET condition_grade = $1,
                contains_hazardous_materials = (contains_hazardous_materials OR $2)
          WHERE device_id = $3`,
        [overall_grade, Boolean(hazard_detected), device.device_id]
      );

      let updatedStatus = 'UNDER_INSPECTION';
      if (auto_advance_status) {
        const pathwayStatusMap = {
          DIRECT_REUSE: 'READY_FOR_REUSE',
          REPAIR: 'REPAIRABLE',
          DISMANTLE: 'UNDER_DISMANTLING',
          RECYCLE: 'UNDER_RECYCLING',
          // For HAZARDOUS_DISPOSAL, device remains in UNDER_INSPECTION (or UNDER_RECYCLING)
          // until the authorized TSDF disposal_records manifest is logged!
          HAZARDOUS_DISPOSAL: null,
        };

        const targetStatus = pathwayStatusMap[recommended_pathway];
        if (targetStatus) {
          await setTransitionContext(client, {
            userId: actor.user_id,
            referenceEntity: 'INSPECTION',
            referenceId: inspection.inspection_id,
            notes: `Inspection ${inspectionCode} recommended pathway: ${recommended_pathway}`,
          });
          const statusUpd = await client.query(
            'UPDATE devices SET current_status = $1 WHERE device_id = $2 RETURNING current_status',
            [targetStatus, device.device_id]
          );
          updatedStatus = statusUpd.rows[0].current_status;
        }
      }

      return {
        inspection,
        device_new_status: updatedStatus,
      };
    },
    { userId: actor.user_id, clientIp }
  );
}

module.exports = {
  listInspections,
  createInspection,
};
