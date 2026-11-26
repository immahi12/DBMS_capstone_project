const { query, withTransaction } = require('../../config/database');
const ApiError = require('../../utils/ApiError');

async function listRecoveredComponents(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    const idx = params.length;
    conditions.push(
      `(component_uid ILIKE $${idx} OR source_device_tracking_no ILIKE $${idx} OR component_type_name ILIKE $${idx} OR COALESCE(target_reuse_device_tracking_no, '') ILIKE $${idx})`
    );
  }
  if (filters.destination_type) {
    params.push(filters.destination_type);
    conditions.push(`destination_type = $${params.length}`);
  }
  if (filters.current_status) {
    params.push(filters.current_status);
    conditions.push(`current_status = $${params.length}`);
  }
  if (filters.condition_status) {
    params.push(filters.condition_status);
    conditions.push(`condition_status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(
    `SELECT *
       FROM vw_component_full_lineage
       ${where}
      ORDER BY recovered_component_id DESC
      LIMIT 150`,
    params
  );

  const summaryRes = await query(`
    SELECT
      destination_type,
      COUNT(*) AS count,
      ROUND(SUM(weight_kg)::NUMERIC, 3) AS total_weight_kg,
      ROUND(SUM(estimated_value_inr)::NUMERIC, 2) AS total_value_inr
    FROM recovered_components
    GROUP BY destination_type
    ORDER BY count DESC;
  `);

  return {
    components: res.rows,
    destination_summary: summaryRes.rows,
  };
}

async function getComponentRecursiveLineage(uidOrId) {
  const isNum = /^\d+$/.test(String(uidOrId).trim());
  const rootRes = isNum
    ? await query('SELECT * FROM vw_component_full_lineage WHERE recovered_component_id = $1', [Number(uidOrId)])
    : await query('SELECT * FROM vw_component_full_lineage WHERE UPPER(component_uid) = UPPER($1)', [String(uidOrId).trim()]);

  if (rootRes.rowCount === 0) {
    throw new ApiError(404, `Component '${uidOrId}' not found.`, 'COMPONENT_NOT_FOUND');
  }
  const comp = rootRes.rows[0];

  // Recursive CTE capturing ancestors & descendants of this component
  const familyTreeRes = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT recovered_component_id, parent_recovered_component_id
         FROM recovered_components
        WHERE recovered_component_id = $1
       UNION ALL
       SELECT p.recovered_component_id, p.parent_recovered_component_id
         FROM recovered_components p
         INNER JOIN ancestors a ON p.recovered_component_id = a.parent_recovered_component_id
     ),
     top_root AS (
       SELECT recovered_component_id
         FROM ancestors
        WHERE parent_recovered_component_id IS NULL
        LIMIT 1
     ),
     full_tree AS (
       SELECT rc.recovered_component_id, rc.component_uid, rc.parent_recovered_component_id,
              1 AS depth, rc.component_uid::TEXT AS path
         FROM recovered_components rc
         INNER JOIN top_root tr ON rc.recovered_component_id = tr.recovered_component_id
       UNION ALL
       SELECT c.recovered_component_id, c.component_uid, c.parent_recovered_component_id,
              ft.depth + 1, ft.path || ' -> ' || c.component_uid
         FROM recovered_components c
         INNER JOIN full_tree ft ON c.parent_recovered_component_id = ft.recovered_component_id
     )
     SELECT ft.depth, ft.path, vcl.*
       FROM full_tree ft
       INNER JOIN vw_component_full_lineage vcl
               ON vcl.recovered_component_id = ft.recovered_component_id
      ORDER BY ft.path ASC`,
    [comp.recovered_component_id]
  );

  return {
    component: comp,
    lineage_tree: familyTreeRes.rows,
  };
}

async function updateComponentStatus(componentId, payload, actor) {
  const { current_status, destination_type, recycling_facility_id = null, destination_notes = null } = payload;

  return withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE recovered_components
          SET current_status = COALESCE($1, current_status),
              destination_type = COALESCE($2, destination_type),
              recycling_facility_id = COALESCE($3, recycling_facility_id),
              destination_notes = COALESCE($4, destination_notes)
        WHERE recovered_component_id = $5
        RETURNING *`,
      [current_status || null, destination_type || null, recycling_facility_id || null, destination_notes, Number(componentId)]
    );
    if (upd.rowCount === 0) {
      throw new ApiError(404, 'Recovered component not found.', 'COMPONENT_NOT_FOUND');
    }
    return upd.rows[0];
  }, { userId: actor.user_id });
}

module.exports = {
  listRecoveredComponents,
  getComponentRecursiveLineage,
  updateComponentStatus,
};
