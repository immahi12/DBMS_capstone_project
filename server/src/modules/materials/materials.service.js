const { query, withTransaction, setTransitionContext } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listMaterialRecoveries() {
  const [recordsRes, materialsCatalogRes, eligibleDevicesRes, matTotalsRes] = await Promise.all([
    query(`
      SELECT
        mrr.*,
        d.tracking_number,
        d.brand || ' ' || d.model_name AS source_device_name,
        d.current_status AS source_device_status,
        rc.component_uid,
        m.material_code,
        m.name AS material_name,
        m.material_class,
        m.is_hazardous,
        ROUND((mrr.recovered_weight_kg * m.market_value_per_kg_inr)::NUMERIC, 2) AS lot_value_inr,
        ROUND((mrr.recovered_weight_kg * m.co2_saved_per_kg)::NUMERIC, 3) AS co2_saved_kg,
        rf.name AS facility_name,
        rf.facility_code,
        u.full_name AS recorded_by_name
      FROM material_recovery_records mrr
      INNER JOIN devices d              ON d.device_id = mrr.source_device_id
      INNER JOIN materials m            ON m.material_id = mrr.material_id
      INNER JOIN recycling_facilities rf ON rf.facility_id = mrr.facility_id
      INNER JOIN users u                ON u.user_id = mrr.recorded_by
      LEFT JOIN recovered_components rc ON rc.recovered_component_id = mrr.recovered_component_id
      ORDER BY mrr.recovery_id DESC
      LIMIT 120;
    `),
    query(`
      SELECT
        m.*,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'facility_id', fam.facility_id,
                'facility_name', rf.name,
                'recovery_efficiency_pct', fam.recovery_efficiency_pct
              )
            )
            FROM facility_accepted_materials fam
            INNER JOIN recycling_facilities rf ON rf.facility_id = fam.facility_id
            WHERE fam.material_id = m.material_id AND rf.is_active = TRUE
          ),
          '[]'::json
        ) AS accepted_facilities
      FROM materials m
      ORDER BY m.name ASC;
    `),
    query(`
      SELECT device_id, tracking_number, brand, model_name, weight_kg, current_status
        FROM devices
       WHERE current_status IN ('DISMANTLED', 'UNDER_RECYCLING', 'RECYCLED')
       ORDER BY device_id DESC;
    `),
    query(`
      SELECT
        m.name AS material_name,
        m.material_class,
        COUNT(mrr.recovery_id) AS lot_count,
        COALESCE(ROUND(SUM(mrr.recovered_weight_kg)::NUMERIC, 3), 0) AS total_kg,
        COALESCE(ROUND(SUM(mrr.recovered_weight_kg * m.co2_saved_per_kg)::NUMERIC, 2), 0) AS co2_saved_kg
      FROM materials m
      LEFT JOIN material_recovery_records mrr ON mrr.material_id = m.material_id
      GROUP BY m.material_id, m.name, m.material_class
      ORDER BY total_kg DESC;
    `),
  ]);

  return {
    records: recordsRes.rows,
    materials_catalog: materialsCatalogRes.rows,
    eligible_devices: eligibleDevicesRes.rows,
    material_summary: matTotalsRes.rows,
  };
}

async function recordMaterialRecovery(payload, actor, clientIp) {
  const {
    source_device_id,
    recovered_component_id = null,
    material_id,
    facility_id,
    recovered_weight_kg,
    purity_grade_pct = 96.0,
    recycling_status = 'PROCESSED_VERIFIED',
    certificate_ref = null,
    notes = null,
    mark_device_recycled = false,
  } = payload;

  if (!source_device_id || !material_id || !facility_id || !recovered_weight_kg) {
    throw new ApiError(
      400,
      'source_device_id, material_id, facility_id, and recovered_weight_kg are required.',
      'VALIDATION_ERROR'
    );
  }

  return withTransaction(
    async (client) => {
      // Enforce M:N licensing rule: facility must accept the target material!
      const licenseCheck = await client.query(
        `SELECT 1
           FROM facility_accepted_materials
          WHERE facility_id = $1 AND material_id = $2`,
        [Number(facility_id), Number(material_id)]
      );
      if (licenseCheck.rowCount === 0) {
        throw new ApiError(
          400,
          'Selected recycling facility is not licensed to process the specified material.',
          'FACILITY_MATERIAL_MISMATCH'
        );
      }

      const devRes = await client.query(
        'SELECT * FROM devices WHERE device_id = $1 FOR UPDATE',
        [Number(source_device_id)]
      );
      if (devRes.rowCount === 0) {
        throw new ApiError(404, 'Source device not found.', 'DEVICE_NOT_FOUND');
      }
      const device = devRes.rows[0];

      const seqRes = await client.query(
        'SELECT COALESCE(MAX(recovery_id), 0) + 1 AS next_id FROM material_recovery_records'
      );
      const lotNumber = `MAT-2026-${String(seqRes.rows[0].next_id).padStart(4, '0')}`;

      const confirmedDate = recycling_status === 'PROCESSED_VERIFIED' ? new Date().toISOString().slice(0, 10) : null;

      const insertRes = await client.query(
        `INSERT INTO material_recovery_records
          (lot_number, source_device_id, recovered_component_id, material_id, facility_id,
           recorded_by, recovered_weight_kg, purity_grade_pct, recycling_status,
           recovery_date, recycled_confirmed_date, certificate_ref, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE,$10,$11,$12)
         RETURNING *`,
        [
          lotNumber,
          device.device_id,
          recovered_component_id ? Number(recovered_component_id) : null,
          Number(material_id),
          Number(facility_id),
          actor.user_id,
          Number(recovered_weight_kg),
          purity_grade_pct ? Number(purity_grade_pct) : null,
          recycling_status,
          confirmedDate,
          certificate_ref || `CERT-${lotNumber}`,
          notes,
        ]
      );
      const rec = insertRes.rows[0];

      if (recovered_component_id) {
        await client.query(
          `UPDATE recovered_components
              SET current_status = 'RECYCLED',
                  recycling_facility_id = $1
            WHERE recovered_component_id = $2`,
          [Number(facility_id), Number(recovered_component_id)]
        );
      }

      if (mark_device_recycled && ['DISMANTLED', 'UNDER_RECYCLING'].includes(device.current_status)) {
        await setTransitionContext(client, {
          userId: actor.user_id,
          referenceEntity: 'RECYCLING',
          referenceId: rec.recovery_id,
          notes: `Material recovery lot ${lotNumber} verified; device marked RECYCLED`,
        });
        await client.query(
          `UPDATE devices SET current_status = 'RECYCLED' WHERE device_id = $1`,
          [device.device_id]
        );
      }

      return rec;
    },
    { userId: actor.user_id, clientIp }
  );
}

module.exports = {
  listMaterialRecoveries,
  recordMaterialRecovery,
};
