const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listDisposalRecords() {
  const [recordsRes, tsdfFacilitiesRes, pendingHazardDevicesRes] = await Promise.all([
    query(`
      SELECT
        dr.*,
        d.tracking_number,
        d.brand || ' ' || d.model_name AS device_name,
        d.current_status AS device_status,
        rc.component_uid,
        rf.name AS facility_name,
        rf.facility_code,
        rf.certification_number,
        u.full_name AS authorized_by_name
      FROM disposal_records dr
      INNER JOIN devices d              ON d.device_id = dr.device_id
      INNER JOIN recycling_facilities rf ON rf.facility_id = dr.facility_id
      INNER JOIN users u                ON u.user_id = dr.authorized_by
      LEFT JOIN recovered_components rc ON rc.recovered_component_id = dr.recovered_component_id
      ORDER BY dr.disposal_id DESC
      LIMIT 100;
    `),
    query(`
      SELECT facility_id, facility_code, name, facility_type, certification_number,
             license_valid_until, authorized_for_hazardous, city, state
        FROM recycling_facilities
       WHERE is_active = TRUE
       ORDER BY authorized_for_hazardous DESC, name ASC;
    `),
    // Uses partial index idx_devices_hazardous_pending_partial!
    query(`
      SELECT device_id, tracking_number, brand, model_name, weight_kg, current_status
        FROM devices
       WHERE current_status IN ('UNDER_INSPECTION', 'DISMANTLED', 'UNDER_RECYCLING')
       ORDER BY contains_hazardous_materials DESC, device_id DESC;
    `),
  ]);

  return {
    disposal_records: recordsRes.rows,
    facilities: tsdfFacilitiesRes.rows,
    candidate_devices: pendingHazardDevicesRes.rows,
  };
}

async function createDisposalRecord(payload, actor, clientIp) {
  const {
    device_id,
    recovered_component_id = null,
    facility_id,
    hazard_classification,
    treatment_method,
    hazard_weight_kg,
    compliance_certificate_no = null,
    evidence_document_ref = null,
    disposal_cost_inr = 0,
    notes = null,
    mark_device_disposed = true,
  } = payload;

  if (!device_id || !facility_id || !hazard_classification || !treatment_method || !hazard_weight_kg) {
    throw new ApiError(
      400,
      'device_id, facility_id, hazard_classification, treatment_method, and hazard_weight_kg are required.',
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

      const seqRes = await client.query(
        'SELECT COALESCE(MAX(disposal_id), 0) + 1 AS next_id FROM disposal_records'
      );
      const nextNum = seqRes.rows[0].next_id;
      const manifestNumber = `HAZ-MAN-2026-${String(nextNum).padStart(4, '0')}`;
      const certNo =
        compliance_certificate_no || `TSDF-CERT-2026-${String(9000 + nextNum)}`;

      // Trigger trg_validate_hazardous_disposal_facility validates TSDF authorization & license expiry!
      const dispRes = await client.query(
        `INSERT INTO disposal_records
          (manifest_number, device_id, recovered_component_id, facility_id, authorized_by,
           hazard_classification, treatment_method, hazard_weight_kg, compliance_certificate_no,
           evidence_document_ref, disposal_cost_inr, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          manifestNumber,
          device.device_id,
          recovered_component_id ? Number(recovered_component_id) : null,
          Number(facility_id),
          actor.user_id,
          hazard_classification,
          treatment_method,
          Number(hazard_weight_kg),
          certNo,
          evidence_document_ref || `s3://reloop-manifests/2026/${manifestNumber}.pdf`,
          Number(disposal_cost_inr || 0),
          notes,
        ]
      );
      const disposal = dispRes.rows[0];

      if (recovered_component_id) {
        await client.query(
          `UPDATE recovered_components
              SET current_status = 'HAZARDOUS_DISPOSED',
                  destination_type = 'HAZARDOUS_DISPOSAL',
                  recycling_facility_id = $1
            WHERE recovered_component_id = $2`,
          [Number(facility_id), Number(recovered_component_id)]
        );
      }

      if (
        mark_device_disposed &&
        ['UNDER_INSPECTION', 'DISMANTLED', 'UNDER_RECYCLING'].includes(device.current_status)
      ) {
        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'DISPOSAL',
          referenceId: disposal.disposal_id,
          notes: `Hazardous disposal manifest ${manifestNumber} certified (${certNo})`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'DISPOSED' WHERE device_id = $1`,
          [device.device_id]
        );
      }

      return disposal;
    },
    { userId: actor.user_id, clientIp }
  );
}

module.exports = {
  listDisposalRecords,
  createDisposalRecord,
};
