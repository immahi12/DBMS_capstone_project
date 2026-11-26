const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listRepairs() {
  const [repairsRes, queueRes, sparePartsRes] = await Promise.all([
    query(`
      SELECT
        r.*,
        d.tracking_number,
        d.brand,
        d.model_name,
        d.current_status AS device_status,
        u.full_name AS technician_name,
        o.name AS reuse_organization_name,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'component_uid', rc.component_uid,
                'component_name', cc.name,
                'source_device_id', rc.source_device_id
              )
            )
            FROM recovered_components rc
            INNER JOIN component_catalog cc ON cc.component_type_id = rc.component_type_id
            WHERE rc.installed_in_repair_id = r.repair_id
          ),
          '[]'::json
        ) AS installed_components
      FROM repair_records r
      INNER JOIN devices d ON d.device_id = r.device_id
      INNER JOIN users u   ON u.user_id   = r.technician_id
      LEFT JOIN organizations o ON o.organization_id = r.reuse_destination_org_id
      ORDER BY r.repair_id DESC
      LIMIT 100;
    `),
    query(`
      SELECT device_id, tracking_number, brand, model_name, current_status,
             estimated_value_inr, category_name, current_center_name
        FROM vw_device_master_overview
       WHERE current_status IN ('REPAIRABLE', 'UNDER_REPAIR', 'REFURBISHED')
       ORDER BY current_status ASC, device_id DESC;
    `),
    // Partial index idx_components_reusable_stock_partial powers this fast query!
    query(`
      SELECT
        rc.recovered_component_id,
        rc.component_uid,
        cc.name AS component_type_name,
        rc.condition_status,
        rc.estimated_value_inr,
        sd.tracking_number AS harvested_from_device
      FROM recovered_components rc
      INNER JOIN component_catalog cc ON cc.component_type_id = rc.component_type_id
      INNER JOIN devices sd           ON sd.device_id = rc.source_device_id
      WHERE rc.current_status = 'IN_INVENTORY'
        AND rc.condition_status IN ('WORKING', 'REPAIRABLE')
      ORDER BY rc.estimated_value_inr DESC;
    `),
  ]);

  return {
    repairs: repairsRes.rows,
    repair_queue: queueRes.rows,
    available_spare_components: sparePartsRes.rows,
  };
}

async function createRepairTicket(payload, actor, clientIp) {
  const {
    device_id,
    issue_diagnosis,
    repair_actions = null,
    estimated_cost_inr = 0,
    spare_component_id = null,
  } = payload;

  if (!device_id || !issue_diagnosis) {
    throw new ApiError(400, 'device_id and issue_diagnosis are required.', 'VALIDATION_ERROR');
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

      if (!['REPAIRABLE', 'UNDER_REPAIR'].includes(device.current_status)) {
        throw new ApiError(
          400,
          `Device ${device.tracking_number} is in status '${device.current_status}'; must be REPAIRABLE or UNDER_REPAIR.`,
          'INVALID_REPAIR_STATE'
        );
      }

      const latestInsp = await client.query(
        'SELECT inspection_id FROM inspections WHERE device_id = $1 ORDER BY inspected_at DESC LIMIT 1',
        [device.device_id]
      );

      const seqRes = await client.query('SELECT COALESCE(MAX(repair_id), 0) + 1 AS next_id FROM repair_records');
      const ticketNumber = `REP-2026-${String(seqRes.rows[0].next_id).padStart(4, '0')}`;

      const repRes = await client.query(
        `INSERT INTO repair_records
          (ticket_number, device_id, inspection_id, technician_id, issue_diagnosis,
           repair_actions, estimated_cost_inr, repair_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS')
         RETURNING *`,
        [
          ticketNumber,
          device.device_id,
          latestInsp.rowCount > 0 ? latestInsp.rows[0].inspection_id : null,
          actor.user_id,
          issue_diagnosis,
          repair_actions,
          Number(estimated_cost_inr || 0),
        ]
      );
      const repair = repRes.rows[0];

      if (spare_component_id) {
        const compRes = await client.query(
          `SELECT * FROM recovered_components
            WHERE recovered_component_id = $1
              AND current_status = 'IN_INVENTORY'
            FOR UPDATE`,
          [Number(spare_component_id)]
        );
        if (compRes.rowCount === 0) {
          throw new ApiError(
            409,
            'Selected spare component is no longer available in inventory.',
            'COMPONENT_UNAVAILABLE'
          );
        }
        await client.query(
          `UPDATE recovered_components
              SET current_status = 'ALLOCATED_TO_REPAIR',
                  installed_in_repair_id = $1,
                  destination_notes = $2
            WHERE recovered_component_id = $3`,
          [
            repair.repair_id,
            `Allocated to repair ticket ${ticketNumber} for device ${device.tracking_number}`,
            Number(spare_component_id),
          ]
        );
      }

      if (device.current_status === 'REPAIRABLE') {
        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'REPAIR',
          referenceId: repair.repair_id,
          notes: `Repair workbench ticket ${ticketNumber} started`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'UNDER_REPAIR' WHERE device_id = $1`,
          [device.device_id]
        );
      }

      return repair;
    },
    { userId: actor.user_id, clientIp }
  );
}

async function resolveRepairTicket(repairId, payload, actor, clientIp) {
  const {
    outcome = 'COMPLETED', // COMPLETED or UNREPAIRABLE_ESCALATED
    repair_actions = '',
    actual_cost_inr = 0,
    reuse_destination_org_id = null,
    reuse_channel = 'REFURBISHED_RESALE',
    resale_value_inr = 0,
    certify_ready_for_reuse = false,
  } = payload;

  return withTransaction(
    async (client) => {
      const repRes = await client.query(
        'SELECT * FROM repair_records WHERE repair_id = $1 FOR UPDATE',
        [Number(repairId)]
      );
      if (repRes.rowCount === 0) {
        throw new ApiError(404, 'Repair ticket not found.', 'REPAIR_NOT_FOUND');
      }
      const repair = repRes.rows[0];

      if (outcome === 'COMPLETED') {
        const updRep = await client.query(
          `UPDATE repair_records
              SET repair_status = 'COMPLETED',
                  qa_verified = TRUE,
                  repair_actions = COALESCE(NULLIF($1, ''), repair_actions, 'Bench refurbishment and QA completed'),
                  actual_cost_inr = $2,
                  reuse_destination_org_id = $3,
                  reuse_channel = $4,
                  resale_value_inr = $5,
                  completed_at = NOW()
            WHERE repair_id = $6
            RETURNING *`,
          [
            repair_actions,
            Number(actual_cost_inr || 0),
            reuse_destination_org_id || null,
            reuse_channel || 'REFURBISHED_RESALE',
            Number(resale_value_inr || 0),
            repair.repair_id,
          ]
        );

        // Mark any allocated harvested component as permanently REUSED_IN_DEVICE
        await client.query(
          `UPDATE recovered_components
              SET current_status = 'REUSED_IN_DEVICE',
                  destination_type = 'REUSE'
            WHERE installed_in_repair_id = $1`,
          [repair.repair_id]
        );

        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'REPAIR',
          referenceId: repair.repair_id,
          notes: `Repair ${repair.ticket_number} completed & QA verified`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'REFURBISHED' WHERE device_id = $1`,
          [repair.device_id]
        );

        if (certify_ready_for_reuse) {
          await setTransitionContext(client, {
            userId: actor.user_id,
            referenceEntity: 'REUSE_CERTIFICATION',
            referenceId: repair.repair_id,
            notes: `Certified READY_FOR_REUSE (${reuse_channel})`,
          });
          await client.query(
            `UPDATE devices SET current_status = 'READY_FOR_REUSE' WHERE device_id = $1`,
            [repair.device_id]
          );
        }

        return updRep.rows[0];
      }

      if (outcome === 'UNREPAIRABLE_ESCALATED') {
        const updRep = await client.query(
          `UPDATE repair_records
              SET repair_status = 'UNREPAIRABLE_ESCALATED',
                  qa_verified = FALSE,
                  repair_actions = COALESCE(NULLIF($1, ''), repair_actions, 'Unrepairable board fault; escalated to dismantling'),
                  actual_cost_inr = $2,
                  completed_at = NOW()
            WHERE repair_id = $3
            RETURNING *`,
          [repair_actions, Number(actual_cost_inr || 0), repair.repair_id]
        );

        // Return any allocated spare part safely back to inventory!
        await client.query(
          `UPDATE recovered_components
              SET current_status = 'IN_INVENTORY',
                  installed_in_repair_id = NULL
            WHERE installed_in_repair_id = $1`,
          [repair.repair_id]
        );

        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'REPAIR_ESCALATION',
          referenceId: repair.repair_id,
          notes: `Repair ${repair.ticket_number} deemed unfeasible; escalated to dismantling`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'UNDER_DISMANTLING' WHERE device_id = $1`,
          [repair.device_id]
        );

        return updRep.rows[0];
      }

      throw new ApiError(400, `Unsupported repair outcome: ${outcome}`, 'VALIDATION_ERROR');
    },
    { userId: actor.user_id, clientIp }
  );
}

module.exports = {
  listRepairs,
  createRepairTicket,
  resolveRepairTicket,
};
