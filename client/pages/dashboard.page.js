window.ReLoopPages = window.ReLoopPages || {};

window.ReLoopPages.renderDashboard = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge, renderChart } = window.ReLoopUI;
  container.innerHTML = `<div class="card"><p class="card-subtitle">Querying PostgreSQL analytical views (vw_kpi_executive_summary, vw_center_performance_metrics, vw_facility_performance_metrics)...</p></div>`;

  const data = await window.ReLoopAPI.get('/api/analytics/dashboard');
  const k = data.kpis;

  container.innerHTML = `
    <div class="callout">
      <strong>KPI Methodology (Zero Double-Counting):</strong>
      Device Recycling Rate (<strong>${fmtNum(k.recycling_rate_pct, 2)}%</strong>) and Circular Diversion Rate (<strong>${fmtNum(k.circular_diversion_rate_pct, 2)}%</strong>)
      are computed strictly over terminally processed <code>devices</code> records—harvested components (${fmtNum(k.total_recovered_components)}) and material recovery lots (${fmtNum(k.total_material_recovered_kg, 2)} kg) are tracked in separate circular-yield KPIs and never inflated into recycled device counts.
    </div>

    <div class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">1. Total Devices Collected</div>
        <div class="kpi-value">${fmtNum(k.total_devices_collected)}</div>
        <div class="kpi-foot">${fmtNum(k.total_ewaste_weight_kg, 2)} kg gross e-waste mass</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">2. Under Inspection</div>
        <div class="kpi-value">${fmtNum(k.devices_under_inspection)}</div>
        <div class="kpi-foot">Active diagnostic bench queue</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">3. Devices Repaired</div>
        <div class="kpi-value">${fmtNum(k.devices_repaired)}</div>
        <div class="kpi-foot">Completed QA-verified repairs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">4. Refurbished / Reuse</div>
        <div class="kpi-value">${fmtNum(k.devices_refurbished)}</div>
        <div class="kpi-foot">${fmtNum(k.devices_ready_for_reuse)} Ready for Reuse · ${fmtNum(k.devices_currently_refurbished)} Refurbished</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">5. Devices Dismantled</div>
        <div class="kpi-value">${fmtNum(k.devices_dismantled)}</div>
        <div class="kpi-foot">1:1 structural teardown records</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">6. Total Devices Recycled</div>
        <div class="kpi-value">${fmtNum(k.total_devices_recycled)}</div>
        <div class="kpi-foot">Verified material recovery completion</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">7. Hazardous Disposed</div>
        <div class="kpi-value">${fmtNum(k.devices_disposed || k.total_devices_disposed)}</div>
        <div class="kpi-foot">Authorized TSDF Form-10 manifests</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">8. Recovered Components</div>
        <div class="kpi-value">${fmtNum(k.total_recovered_components)}</div>
        <div class="kpi-foot">${fmtNum(k.reusable_components_count)} routed to Reuse / Resale / Repair</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">9. Material Recovered</div>
        <div class="kpi-value">${fmtNum(k.total_material_recovered_kg, 2)} kg</div>
        <div class="kpi-foot">${fmtNum(k.total_co2_saved_kg, 1)} kg CO₂ saved · ${fmtINR(k.total_material_value_inr)}</div>
      </div>
      <div class="kpi-card highlight">
        <div class="kpi-label">10. Recycling & Circular Rate</div>
        <div class="kpi-value">${fmtNum(k.recycling_rate_pct, 1)}%</div>
        <div class="kpi-foot">Circular Diversion (Reuse+Recycled): ${fmtNum(k.circular_diversion_rate_pct, 1)}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">11. Repair Success Rate</div>
        <div class="kpi-value">${fmtNum(k.repair_success_rate_pct, 1)}%</div>
        <div class="kpi-foot">Completed vs escalated repair tickets</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">12. Monthly E-Waste Collection Trends (2026)</h3>
            <p class="card-subtitle">Aggregated monthly intake mass (kg) and collected device count</p>
          </div>
        </div>
        <div class="chart-box">
          <canvas id="chart-monthly-trends"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">13. Category-Wise E-Waste Distribution</h3>
            <p class="card-subtitle">Collected mass (kg) across leaf e-waste categories</p>
          </div>
        </div>
        <div class="chart-box">
          <canvas id="chart-category-dist"></canvas>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">14. Collection Center Performance & Storage Utilization</h3>
          <p class="card-subtitle">Powered by SQL View <code>vw_center_performance_metrics</code> (LEFT JOIN detects idle/maintenance hubs)</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Collection Center</th>
              <th>City</th>
              <th>Status</th>
              <th>Batches</th>
              <th>Devices</th>
              <th>Handled (kg)</th>
              <th>Active Load / Capacity</th>
              <th>Reuse</th>
              <th>Recycled</th>
              <th>Disposed</th>
            </tr>
          </thead>
          <tbody>
            ${data.center_performance
              .map(
                (c) => `
              <tr>
                <td class="mono">${esc(c.center_code)}</td>
                <td><strong>${esc(c.center_name)}</strong></td>
                <td>${esc(c.city)}, ${esc(c.state)}</td>
                <td>${statusBadge(c.operating_status)}</td>
                <td>${fmtNum(c.total_batches_received)}</td>
                <td>${fmtNum(c.total_devices_assigned)}</td>
                <td>${fmtNum(c.total_weight_handled_kg, 2)} kg</td>
                <td>${fmtNum(c.active_inventory_weight_kg, 1)} / ${fmtNum(c.storage_capacity_kg, 0)} kg (${fmtNum(c.capacity_utilization_pct, 1)}%)</td>
                <td>${fmtNum(c.refurbished_reuse_count)}</td>
                <td>${fmtNum(c.recycled_count)}</td>
                <td>${fmtNum(c.disposed_count)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">15. Certified Recycling & TSDF Facility Performance</h3>
            <p class="card-subtitle">Powered by SQL View <code>vw_facility_performance_metrics</code></p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Type</th>
                <th>Recovered (kg)</th>
                <th>Avg Purity</th>
                <th>CO₂ Offset</th>
                <th>Haz Disposed</th>
              </tr>
            </thead>
            <tbody>
              ${data.facility_performance
                .map(
                  (f) => `
                <tr>
                  <td>
                    <strong>${esc(f.facility_name)}</strong>
                    <div class="card-subtitle mono">${esc(f.certification_number)}</div>
                  </td>
                  <td><span class="badge badge-slate">${esc(f.facility_type.replace(/_/g, ' '))}</span></td>
                  <td><strong>${fmtNum(f.total_recovered_kg, 2)} kg</strong> (${fmtNum(f.verified_lots_count)} lots)</td>
                  <td>${fmtNum(f.avg_purity_pct, 1)}%</td>
                  <td>${fmtNum(f.co2_saved_kg, 1)} kg</td>
                  <td>${fmtNum(f.total_hazard_disposed_kg, 2)} kg</td>
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
            <h3 class="card-title">Recent Immutable Lifecycle Ledger Events</h3>
            <p class="card-subtitle">Append-only transitions protected by <code>trg_protect_immutable_lifecycle_events</code></p>
          </div>
          <a href="#/traceability" class="btn btn-secondary btn-sm">Open Traceability Explorer</a>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Transition</th>
                <th>Actor</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${data.recent_lifecycle_events
                .map(
                  (ev) => `
                <tr>
                  <td><a class="link-code mono" href="#/devices/${esc(ev.tracking_number)}">${esc(ev.tracking_number)}</a></td>
                  <td>${ev.from_status ? statusBadge(ev.from_status) + ' → ' : ''}${statusBadge(ev.to_status)}</td>
                  <td>${esc(ev.actor_name)}</td>
                  <td>${fmtDate(ev.occurred_at, true)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Render Chart 12: Monthly Trends
  renderChart('chart-monthly-trends', {
    type: 'bar',
    data: {
      labels: data.monthly_trends.map((m) => m.month_bucket),
      datasets: [
        {
          type: 'bar',
          label: 'Collected Mass (kg)',
          data: data.monthly_trends.map((m) => m.weight_collected_kg),
          backgroundColor: 'rgba(5, 150, 105, 0.78)',
          borderRadius: 5,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Devices Collected',
          data: data.monthly_trends.map((m) => m.devices_collected),
          borderColor: '#0f172a',
          backgroundColor: '#0f172a',
          tension: 0.25,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { position: 'left', title: { display: true, text: 'Mass (kg)' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Devices' } },
      },
    },
  });

  // Render Chart 13: Category Distribution
  renderChart('chart-category-dist', {
    type: 'doughnut',
    data: {
      labels: data.category_distribution.map((c) => c.category_name),
      datasets: [
        {
          data: data.category_distribution.map((c) => c.total_weight_kg),
          backgroundColor: [
            '#064e3b', '#059669', '#10b981', '#34d399',
            '#0d9488', '#0284c7', '#475569', '#d97706', '#dc2626',
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
      },
    },
  });
};
