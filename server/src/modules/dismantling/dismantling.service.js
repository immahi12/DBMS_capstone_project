const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listDismantlingOperations() {
  const [recordsRes, queueRes, componentCatalogRes] = await Promise.all([
    query(`
      SELECT
        dr.*,
        d.tracking_number,
        d.brand,
        d.model_name,
        d.weight_kg AS device_weight_kg,
        d.current_status AS device_status,
        u.full_name AS operator_name,
        cc.name AS center_name
      FROM dismantling_records dr
      INNER JOIN devices d             ON d.device_id = dr.device_id
      INNER JOIN users u               ON u.user_id   = dr.operator_id
      INNER JOIN collection_centers cc ON cc.center_id = dr.center_id
      ORDER BY dr.dismantled_at DESC
      LIMIT 100;
    `),
    query(`
      SELECT device_id, tracking_number, brand, model_name, weight_kg,
             current_status, category_name, current_center_id, current_center_name
        FROM vw_device_master_overview
       WHERE current_status = 'UNDER_DISMANTLING'
       ORDER BY device_id ASC;
    `),
    query('SELECT * FROM component_catalog ORDER BY component_group, name'),
  ]);

  return {
    dismantling_records: recordsRes.rows,
    dismantling_queue: queueRes.rows,
    component_catalog: componentCatalogRes.rows,
  };
}

/**
 * Workflow 4: Transactional Dismantling & Component-Level Harvesting
 * Demonstrates ACID transaction with REPEATABLE READ isolation & SAVEPOINT protection.
 */
async function executeDismantling(payload, actor, clientIp) {
  const {
    device_id,
    dismantling_method = 'MANUAL_PRECISION',
    safety_protocol_verified = true,
    residual_scrap_kg = 0,
    notes = null,
    components = [],
  } = payload;

  if (!device_id || !Array.isArray(components) || components.length === 0) {
    throw new ApiError(
      400,
      'device_id and at least one harvested component in components[] are required.',
      'VALIDATION_ERROR'
    );
  }

  return withTransaction(
    async (client) => {
      const devRes = await client.query(
        'SELECT * FROM devices WHERE device_id = $1 FOR UPDATE',
        [Number(device_id)]
      );
      if (devRes.rowCount === 0) {
        throw new ApiError(404, 'Device not found.', 'DEVICE_NOT_FOUND');
      }
      const device = devRes.rows[0];

      if (device.current_status !== 'UNDER_DISMANTLING') {
        throw new ApiError(
          400,
          `Device ${device.tracking_number} must be in UNDER_DISMANTLING status before dismantling (currently '${device.current_status}').`,
          'INVALID_DISMANTLING_STATE'
        );
      }

      const seqRes = await client.query(
        'SELECT COALESCE(MAX(dismantling_id), 0) + 1 AS next_id FROM dismantling_records'
      );
      const dismantlingCode = `DISM-2026-${String(seqRes.rows[0].next_id).padStart(4, '0')}`;

      const dismRes = await client.query(
        `INSERT INTO dismantling_records
          (dismantling_code, device_id, operator_id, center_id, dismantling_method,
           safety_protocol_verified, residual_scrap_kg, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          dismantlingCode,
          device.device_id,
          actor.user_id,
          device.current_center_id,
          dismantling_method,
          Boolean(safety_protocol_verified),
          Number(residual_scrap_kg || 0),
          notes,
        ]
      );
      const dismantling = dismRes.rows[0];

      await client.query('SAVEPOINT sp_harvest_components');
      const insertedComponents = [];
      try {
        const compSeqBaseRes = await client.query(
          'SELECT COALESCE(MAX(recovered_component_id), 0) AS base_id FROM recovered_components'
        );
        let nextCompNum = compSeqBaseRes.rows[0].base_id + 1;

        for (const comp of components) {
          const componentUid =
            comp.component_uid || `CMP-2026-${String(nextCompNum++).padStart(5, '0')}`;

          const defaultStatusMap = {
            REUSE: 'IN_INVENTORY',
            RESALE: 'SOLD_FOR_REUSE',
            REPAIR: 'IN_INVENTORY',
            RECYCLING: 'SENT_FOR_RECYCLING',
            HAZARDOUS_DISPOSAL: 'EXTRACTED',
          };

          const compStatus =
            comp.current_status || defaultStatusMap[comp.destination_type] || 'IN_INVENTORY';

          const cRes = await client.query(
            `INSERT INTO recovered_components
              (component_uid, dismantling_id, source_device_id, component_type_id,
               parent_recovered_component_id, serial_or_part_no, condition_status,
               weight_kg, estimated_value_inr, current_status, destination_type,
               recycling_facility_id, destination_notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
              componentUid,
              dismantling.dismantling_id,
              device.device_id,
              Number(comp.component_type_id),
              comp.parent_recovered_component_id ? Number(comp.parent_recovered_component_id) : null,
              comp.serial_or_part_no || null,
              comp.condition_status,
              Number(comp.weight_kg),
              Number(comp.estimated_value_inr || 0),
              compStatus,
              comp.destination_type,
              comp.recycling_facility_id ? Number(comp.recycling_facility_id) : null,
              comp.destination_notes || null,
            ]
          );
          insertedComponents.push(cRes.rows[0]);
        }
        await client.query('RELEASE SAVEPOINT sp_harvest_components');
      } catch (compErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_harvest_components');
        throw compErr;
      }

      // Now transition device to DISMANTLED (trigger verifies dismantling_records exists!)
      await setTransitionContext(client, {
        userId: actor.user_id,
        referenceEntity: 'DISMANTLING',
        referenceId: dismantling.dismantling_id,
        notes: `Dismantled (${dismantlingCode}): ${insertedComponents.length} components cataloged`,
      });

      await client.query(
        `UPDATE devices SET current_status = 'DISMANTLED' WHERE device_id = $1`,
        [device.device_id]
      );

      const refreshedDism = await client.query(
        'SELECT * FROM dismantling_records WHERE dismantling_id = $1',
        [dismantling.dismantling_id]
      );

      return {
        dismantling: refreshedDism.rows[0],
        recovered_components: insertedComponents,
      };
    },
    { userId: actor.user_id, clientIp, isolationLevel: 'REPEATABLE READ' }
  );
}

module.exports = {
  listDismantlingOperations,
  executeDismantling,
};
