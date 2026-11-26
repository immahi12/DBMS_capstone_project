window.ReLoopPages = window.ReLoopPages || {};

// Page 13: Complete Chronological Lifecycle Traceability & Lineage (Workflow 7)
window.ReLoopPages.renderTraceability = async function (container, initialTracking = 'RLP-2026-00002') {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge, toast } = window.ReLoopUI;

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Workflow 7: End-to-End Chronological Lifecycle & Component Lineage Explorer</h3>
          <p class="card-subtitle">Combines SQL Window Functions (<code>LAG</code>/<code>LEAD</code> dwell hours) + <code>WITH RECURSIVE</code> multi-level component disassembly & cross-device reuse tracing</p>
        </div>
      </div>

      <div class="filter-bar">
        <input type="text" id="trace-input" value="${esc(initialTracking)}" placeholder="Enter Tracking ID (e.g., RLP-2026-00002)" style="min-width:250px;" />
        <button class="btn btn-primary" id="btn-run-trace">Trace Asset Lineage</button>
        <span class="card-subtitle" style="margin-left:8px;">Showcase Archetypes:</span>
        <button class="btn btn-secondary btn-sm btn-archetype" data-id="RLP-2026-00001">00001 · Refurbished w/ Circular RAM</button>
        <button class="btn btn-secondary btn-sm btn-archetype" data-id="RLP-2026-00002">00002 · Dismantled + Sub-Assembly Tree</button>
        <button class="btn btn-secondary btn-sm btn-archetype" data-id="RLP-2026-00003">00003 · Smartphone Recycled</button>
        <button class="btn btn-secondary btn-sm btn-archetype" data-id="RLP-2026-00004">00004 · TSDF Hazardous Disposal</button>
        <button class="btn btn-secondary btn-sm btn-archetype" data-id="RLP-2026-00005">00005 · Escalated Desktop</button>
      </div>
    </div>

    <div id="trace-output-area"></div>
  `;

  async function loadTrace(trackingId) {
    const out = document.getElementById('trace-output-area');
    out.innerHTML = `<div class="card"><p class="card-subtitle">Executing multi-table provenance, LAG/LEAD window timeline, and WITH RECURSIVE lineage queries for ${esc(trackingId)}...</p></div>`;
    try {
      const b = await window.ReLoopAPI.get(`/api/devices/${encodeURIComponent(trackingId)}/traceability`);
      const d = b.device;
      const m = b.recovery_metrics || {};

      out.innerHTML = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="mono" style="font-size:19px;font-weight:800;color:var(--brand-900);">${esc(d.tracking_number)}</span>
                ${statusBadge(d.current_status)}
              </div>
              <h3 style="margin:6px 0 2px;">${esc(d.brand)} ${esc(d.model_name)} (${esc(d.category_name)})</h3>
              <p class="card-subtitle">
                Origin Donor: <strong>${esc(d.source_organization_name)}</strong> · Batch <span class="mono">${esc(d.batch_number)}</span> (${fmtDate(d.collection_date)}) · Current Hub: <strong>${esc(d.current_center_name)}</strong>
              </p>
            </div>
            <a href="#/devices/${esc(d.tracking_number)}" class="btn btn-secondary">Open Operational Workbench →</a>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <h3 class="card-title">Chronological Lifecycle Timeline (SQL <code>LAG</code> / <code>LEAD</code>)</h3>
            <p class="card-subtitle" style="margin-bottom:14px;">Immutable ledger showing stage-to-stage dwell duration</p>
            <div class="timeline">
              ${b.lifecycle_timeline
                .map(
                  (ev) => `
                <div class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                      <div>
                        ${ev.from_status ? statusBadge(ev.from_status) + ' → ' : ''}
                        ${statusBadge(ev.to_status)}
                      </div>
                      <span class="mono" style="font-size:11.5px;color:var(--text-muted);">${fmtDate(ev.occurred_at, true)}</span>
                    </div>
                    <div style="margin-top:6px;font-size:13px;">${esc(ev.notes || '')}</div>
                    <div class="card-subtitle" style="margin-top:4px;">
                      Actor: <strong>${esc(ev.actor_name)}</strong> (${esc(ev.actor_role)})
                      ${ev.hours_in_previous_stage !== null ? ` · Dwell in prior stage: <strong>${fmtNum(ev.hours_in_previous_stage, 1)} hrs</strong>` : ' · Initial Intake'}
                    </div>
                  </div>
                </div>`
                )
                .join('')}
            </div>
          </div>

          <div>
            <div class="card">
              <h3 class="card-title">Component-Level & Sub-Assembly Lineage Tree</h3>
              <p class="card-subtitle" style="margin-bottom:12px;">Preserves parent-to-component-to-destination links even after dismantling</p>

              ${
                b.installed_circular_components.length > 0
                  ? `<div class="callout">
                      <strong>Inbound Circular Reuse:</strong> This device received harvested component(s) from other dismantled e-waste:
                      ${b.installed_circular_components
                        .map(
                          (ic) =>
                            `<div style="margin-top:4px;">• <span class="mono">${esc(ic.component_uid)}</span> (${esc(ic.component_type_name)}) ← harvested from <a class="link-code mono" href="#/traceability/${esc(ic.source_device_tracking_no)}">${esc(ic.source_device_tracking_no)}</a></div>`
                        )
                        .join('')}
                    </div>`
                  : ''
              }

              ${
                b.recovered_components_lineage.length === 0
                  ? `<div class="empty-state" style="padding:16px;">Device remained intact (not dismantled). Mass: ${fmtNum(d.weight_kg, 2)} kg.</div>`
                  : b.recovered_components_lineage
                      .map(
                        (c) => `
                    <div class="lineage-node" style="margin-left:${(c.tree_depth - 1) * 26}px;">
                      <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span class="mono"><strong>${esc(c.tree_path)}</strong> — ${esc(c.component_type_name)}</span>
                        ${statusBadge(c.current_status)}
                      </div>
                      <div class="card-subtitle" style="margin-top:4px;">
                        Mass: ${fmtNum(c.weight_kg, 3)} kg · Condition: ${esc(c.condition_status)} · Destination: <strong>${esc(c.destination_type)}</strong>
                        ${
                          c.target_reuse_device_tracking_no
                            ? ` → <strong>Installed in <a class="link-code mono" href="#/traceability/${esc(c.target_reuse_device_tracking_no)}">${esc(c.target_reuse_device_tracking_no)}</a></strong>`
                            : c.hazardous_manifest_number
                            ? ` → <strong>TSDF Manifest ${esc(c.hazardous_manifest_number)}</strong>`
                            : c.recycling_facility_name
                            ? ` → <strong>${esc(c.recycling_facility_name)}</strong>`
                            : ''
                        }
                      </div>
                    </div>`
                      )
                      .join('')
              }
            </div>

            <div class="card">
              <h3 class="card-title" style="margin-bottom:10px;">Downstream Material Recovery & TSDF Manifests</h3>
              ${
                b.material_recoveries.length === 0 && b.disposal_records.length === 0
                  ? `<div class="empty-state" style="padding:14px;">No downstream smelter or TSDF records (asset retained in reuse/active pipeline).</div>`
                  : `
                ${b.material_recoveries
                  .map(
                    (mr) => `
                  <div class="lineage-node">
                    <strong class="mono">${esc(mr.lot_number)}</strong> · ${esc(mr.material_name)}: <strong>${fmtNum(mr.recovered_weight_kg, 4)} kg</strong> (${fmtNum(mr.purity_grade_pct, 1)}% purity)
                    <div class="card-subtitle">Recycler: ${esc(mr.facility_name)} · Cert: <span class="mono">${esc(mr.certificate_ref || '—')}</span></div>
                  </div>`
                  )
                  .join('')}
                ${b.disposal_records
                  .map(
                    (dr) => `
                  <div class="lineage-node" style="border-left-color:#dc2626;">
                    <strong class="mono">${esc(dr.manifest_number)}</strong> · <span class="badge badge-red">HAZARDOUS TSDF</span> ${fmtNum(dr.hazard_weight_kg, 3)} kg
                    <div class="card-subtitle">${esc(dr.hazard_classification)} · ${esc(dr.facility_name)} · Cert: <span class="mono">${esc(dr.compliance_certificate_no)}</span></div>
                  </div>`
                  )
                  .join('')}`
              }
              <div style="margin-top:10px;font-size:12.5px;color:var(--text-secondary);">
                <strong>Mass Accountability:</strong> ${fmtNum(m.mass_accounted_pct, 1)}% of ${fmtNum(d.weight_kg, 2)} kg · <strong>Estimated CO₂ Offset:</strong> ${fmtNum(m.estimated_co2_saved_kg, 2)} kg
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      out.innerHTML = `<div class="callout callout-error">${esc(err.message)}</div>`;
      toast(err.message, 'error');
    }
  }

  document.getElementById('btn-run-trace').addEventListener('click', () => {
    const v = document.getElementById('trace-input').value.trim();
    if (v) loadTrace(v);
  });

  container.querySelectorAll('.btn-archetype').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      document.getElementById('trace-input').value = id;
      loadTrace(id);
    });
  });

  await loadTrace(initialTracking);
};

// Page 14: Analytics, Materialized View Reports & Interactive 26-Query DBMS Viva SQL Runner
window.ReLoopPages.renderAnalyticsReports = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, toast } = window.ReLoopUI;
  const [reports, vivaQueries] = await Promise.all([
    window.ReLoopAPI.get('/api/analytics/reports'),
    window.ReLoopAPI.get('/api/analytics/viva-queries'),
  ]);

  container.innerHTML = `
    <div class="card" style="border-color:var(--brand-600);">
      <div class="card-header">
        <div>
          <h3 class="card-title">Interactive DBMS Viva SQL Benchmark Lab (26 Live PostgreSQL Queries)</h3>
          <p class="card-subtitle">Select any curated query (Joins, Subqueries, Recursive CTEs, Window Functions, Views, Stored Functions, <code>EXPLAIN ANALYZE</code>) to execute live inside a <code>READ ONLY</code> PostgreSQL 17 transaction</p>
        </div>
      </div>

      <div class="filter-bar">
        <select id="viva-query-select" style="flex:1;min-width:320px;">
          ${vivaQueries
            .map(
              (q) =>
                `<option value="${esc(q.id)}">${esc(q.id)} [${esc(q.category)}] — ${esc(q.title)}</option>`
            )
            .join('')}
        </select>
        <button class="btn btn-primary" id="btn-exec-viva">▶ Execute Live on PostgreSQL</button>
      </div>

      <div id="viva-query-details"></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Lifecycle Stage Dwell-Time Bottlenecks</h3>
            <p class="card-subtitle">Window function <code>LAG(occurred_at) OVER (PARTITION BY device_id)</code></p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Lifecycle Stage</th>
                <th>Transitions</th>
                <th>Avg Dwell (hrs)</th>
                <th>Min / Max (hrs)</th>
              </tr>
            </thead>
            <tbody>
              ${reports.stage_dwell_analytics
                .map(
                  (s) => `
                <tr>
                  <td><strong>${esc(s.stage_name)}</strong></td>
                  <td>${fmtNum(s.transitions_observed)}</td>
                  <td><strong>${fmtNum(s.avg_dwell_hours, 1)} h</strong></td>
                  <td>${fmtNum(s.min_dwell_hours, 1)}h – ${fmtNum(s.max_dwell_hours, 1)}h</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Materialized View: <code>mv_monthly_ewaste_summary</code></h3>
            <p class="card-subtitle">Supports <code>REFRESH MATERIALIZED VIEW CONCURRENTLY</code></p>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-mv">↻ Refresh Materialized View</button>
        </div>
        <div class="table-wrap" style="max-height:310px;overflow-y:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Category</th>
                <th>Devices</th>
                <th>Mass (kg)</th>
                <th>Reuse</th>
                <th>Recycled</th>
              </tr>
            </thead>
            <tbody>
              ${reports.materialized_monthly_summary
                .slice(0, 20)
                .map(
                  (m) => `
                <tr>
                  <td class="mono">${esc(m.month_bucket)}</td>
                  <td>${esc(m.category_name)}</td>
                  <td>${fmtNum(m.devices_collected)}</td>
                  <td>${fmtNum(m.total_collected_kg, 2)} kg</td>
                  <td>${fmtNum(m.devices_reused_or_refurbished)}</td>
                  <td>${fmtNum(m.devices_recycled)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class=" grid-2">
      <div class="card">
        <h3 class="card-title" style="margin-bottom:12px;">Material Economic Valuation & CO₂ Offset Report</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Material</th>
                <th>Shipments</th>
                <th>Recovered</th>
                <th>Value</th>
                <th>CO₂ Saved</th>
              </tr>
            </thead>
            <tbody>
              ${reports.material_recovery_breakdown
                .map(
                  (m) => `
                <tr>
                  <td class="mono">${esc(m.material_code)}</td>
                  <td><strong>${esc(m.material_name)}</strong></td>
                  <td>${fmtNum(m.shipments)}</td>
                  <td>${fmtNum(m.recovered_kg, 4)} kg</td>
                  <td>${fmtINR(m.economic_value_inr)}</td>
                  <td>${fmtNum(m.co2_offset_kg, 2)} kg</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom:12px;">Database Trigger & RBAC Security Audit Trail (<code>audit_logs</code>)</h3>
        <div class="table-wrap" style="max-height:340px;overflow-y:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Log #</th>
                <th>Table</th>
                <th>Action</th>
                <th>PK</th>
                <th>Actor</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${reports.recent_audit_logs
                .map(
                  (a) => `
                <tr>
                  <td class="mono">#${a.log_id}</td>
                  <td class="mono">${esc(a.table_name)}</td>
                  <td><span class="badge ${a.action_type === 'RBAC_DENIED' ? 'badge-red' : 'badge-slate'}">${esc(a.action_type)}</span></td>
                  <td class="mono">${esc(a.record_pk)}</td>
                  <td>${esc(a.actor_name || 'System/Seed')}</td>
                  <td>${fmtDate(a.created_at, true)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  async function executeSelectedQuery() {
    const qid = document.getElementById('viva-query-select').value;
    const holder = document.getElementById('viva-query-details');
    holder.innerHTML = `<p class="card-subtitle">Running ${esc(qid)} on PostgreSQL...</p>`;
    try {
      const res = await window.ReLoopAPI.post(`/api/analytics/viva-queries/${qid}/run`, {});
      const q = res.query;
      holder.innerHTML = `
        <div style="margin-top:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <strong>Objective:</strong> ${esc(q.objective)}
              <div style="margin-top:4px;">
                ${q.concepts.map((c) => `<span class="badge badge-green" style="margin-right:4px;">${esc(c)}</span>`).join('')}
              </div>
            </div>
            <span class="badge badge-blue">Executed in ${res.execution_ms} ms · ${res.row_count} rows</span>
          </div>
          <pre class="sql-box"><code>${esc(q.sql)}</code></pre>
          <div class="table-wrap" style="max-height:320px;overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>${res.columns.map((col) => `<th>${esc(col)}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${res.rows
                  .map(
                    (row) =>
                      `<tr>${res.columns
                        .map((col) => `<td class="mono">${esc(typeof row[col] === 'object' && row[col] !== null ? JSON.stringify(row[col]) : row[col])}</td>`)
                        .join('')}</tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('btn-exec-viva').addEventListener('click', executeSelectedQuery);
  document.getElementById('viva-query-select').addEventListener('change', executeSelectedQuery);

  document.getElementById('btn-refresh-mv').addEventListener('click', async () => {
    try {
      await window.ReLoopAPI.post('/api/analytics/refresh-views', {});
      toast('Materialized view mv_monthly_ewaste_summary refreshed concurrently!');
      window.ReLoopPages.renderAnalyticsReports(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await executeSelectedQuery();
};
