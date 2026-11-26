const { query, withTransaction } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listFacilities() {
  const [perfRes, acceptedRes, materialsRes] = await Promise.all([
    query('SELECT * FROM vw_facility_performance_metrics ORDER BY total_recovered_kg DESC, facility_id ASC'),
    query(`
      SELECT
        fam.facility_id,
        m.material_id,
        m.material_code,
        m.name AS material_name,
        m.is_hazardous,
        fam.recovery_efficiency_pct
      FROM facility_accepted_materials fam
      INNER JOIN materials m ON m.material_id = fam.material_id
      ORDER BY fam.facility_id, m.name
    `),
    query('SELECT material_id, material_code, name, material_class, is_hazardous FROM materials ORDER BY name'),
  ]);

  const mapByFacility = {};
  for (const row of acceptedRes.rows) {
    if (!mapByFacility[row.facility_id]) mapByFacility[row.facility_id] = [];
    mapByFacility[row.facility_id].push(row);
  }

  const facilities = perfRes.rows.map((f) => ({
    ...f,
    accepted_materials: mapByFacility[f.facility_id] || [],
  }));

  return {
    facilities,
    materials: materialsRes.rows,
  };
}

async function createFacility(payload, actor) {
  const {
    name,
    facility_type,
    certification_number,
    license_valid_until,
    city,
    state,
    processing_capacity_tons_month,
    authorized_for_hazardous = false,
    contact_email,
    contact_phone,
    accepted_material_ids = [],
  } = payload;

  if (!name || !facility_type || !certification_number || !license_valid_until || !city || !state || !processing_capacity_tons_month) {
    throw new ApiError(400, 'Missing required facility registration fields.', 'VALIDATION_ERROR');
  }

  return withTransaction(async (client) => {
    const seqRes = await client.query('SELECT COALESCE(MAX(facility_id), 0) + 1 AS next_id FROM recycling_facilities');
    const code = `FAC-NEW-${String(seqRes.rows[0].next_id).padStart(2, '0')}`;

    const facRes = await client.query(
      `INSERT INTO recycling_facilities
        (facility_code, name, facility_type, certification_number, license_valid_until,
         city, state, processing_capacity_tons_month, authorized_for_hazardous, contact_email, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        code,
        name,
        facility_type,
        certification_number,
        license_valid_until,
        city,
        state,
        Number(processing_capacity_tons_month),
        Boolean(authorized_for_hazardous),
        contact_email || 'compliance@facility-demo.in',
        contact_phone || '+91-9800000000',
      ]
    );
    const facility = facRes.rows[0];

    for (const matId of accepted_material_ids) {
      await client.query(
        `INSERT INTO facility_accepted_materials (facility_id, material_id, recovery_efficiency_pct)
         VALUES ($1,$2,95.0)
         ON CONFLICT (facility_id, material_id) DO NOTHING`,
        [facility.facility_id, Number(matId)]
      );
    }

    return facility;
  }, { userId: actor.user_id });
}

module.exports = {
  listFacilities,
  createFacility,
};
