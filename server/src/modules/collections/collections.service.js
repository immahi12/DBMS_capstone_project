const { query, withTransaction } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function getReferenceMetadata() {
  const [centersRes, orgsRes, categoriesRes, batchesRes, facilitiesRes] = await Promise.all([
    query(
      `SELECT center_id, center_code, name, city, state, storage_capacity_kg, operating_status
         FROM collection_centers
        ORDER BY center_id ASC`
    ),
    query(
      `SELECT organization_id, organization_code, name, org_type, city, state, contact_person
         FROM organizations
        WHERE is_active = TRUE
        ORDER BY name ASC`
    ),
    query(
      `WITH RECURSIVE cat_tree AS (
         SELECT category_id, category_code, name, parent_category_id, hazard_level,
                base_recyclability_pct, 1 AS depth, name::TEXT AS full_path
           FROM e_waste_categories
          WHERE parent_category_id IS NULL
         UNION ALL
         SELECT c.category_id, c.category_code, c.name, c.parent_category_id, c.hazard_level,
                c.base_recyclability_pct, ct.depth + 1, ct.full_path || ' › ' || c.name
           FROM e_waste_categories c
           INNER JOIN cat_tree ct ON c.parent_category_id = ct.category_id
       )
       SELECT * FROM cat_tree ORDER BY full_path ASC`
    ),
    query(
      `SELECT cb.collection_id, cb.batch_number, cb.center_id, cc.name AS center_name,
              cb.source_organization_id, COALESCE(o.name, 'Individual Walk-In') AS organization_name,
              cb.source_type, cb.collection_date, cb.declared_weight_kg,
              COUNT(d.device_id) AS device_count
         FROM collection_batches cb
         INNER JOIN collection_centers cc ON cc.center_id = cb.center_id
         LEFT JOIN organizations o ON o.organization_id = cb.source_organization_id
         LEFT JOIN devices d ON d.collection_id = cb.collection_id
        GROUP BY cb.collection_id, cc.name, o.name
        ORDER BY cb.collection_date DESC, cb.collection_id DESC`
    ),
    query(
      `SELECT facility_id, facility_code, name, facility_type, city, state,
              authorized_for_hazardous, license_valid_until
         FROM recycling_facilities
        WHERE is_active = TRUE
        ORDER BY name ASC`
    ),
  ]);

  return {
    centers: centersRes.rows,
    organizations: orgsRes.rows,
    categories: categoriesRes.rows,
    batches: batchesRes.rows,
    facilities: facilitiesRes.rows,
  };
}

async function createCollectionBatch(payload, actor) {
  const {
    center_id,
    source_organization_id = null,
    source_type,
    collection_date,
    declared_weight_kg = null,
    donor_reference = null,
    pickup_notes = null,
  } = payload;

  if (!center_id || !source_type) {
    throw new ApiError(400, 'center_id and source_type are required.', 'VALIDATION_ERROR');
  }

  return withTransaction(async (client) => {
    const seqRes = await client.query('SELECT COUNT(*) + 1 AS next_seq FROM collection_batches');
    const batchNumber =
      payload.batch_number ||
      `COL-2026-${String(seqRes.rows[0].next_seq).padStart(4, '0')}`;

    const insertRes = await client.query(
      `INSERT INTO collection_batches
        (batch_number, center_id, source_organization_id, source_type,
         collected_by_user_id, collection_date, declared_weight_kg, donor_reference, pickup_notes)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::DATE, CURRENT_DATE),$7,$8,$9)
       RETURNING *`,
      [
        batchNumber,
        center_id,
        source_organization_id || null,
        source_type,
        actor.user_id,
        collection_date || null,
        declared_weight_kg,
        donor_reference,
        pickup_notes,
      ]
    );
    return insertRes.rows[0];
  }, { userId: actor.user_id });
}

module.exports = {
  getReferenceMetadata,
  createCollectionBatch,
};
