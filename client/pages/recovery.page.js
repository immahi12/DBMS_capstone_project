window.ReLoopPages = window.ReLoopPages || {};

// Page 9: Component-Level Traceability Explorer
window.ReLoopPages.renderComponents = async function (container) {
  const { esc, fmtNum, fmtINR, statusBadge, toast } = window.ReLoopUI;
  const initial = await window.ReLoopAPI.get('/api/components');

  container.innerHTML = `
    <div class="kpi-grid">
      ${initial.destination_summary
        .map(
          (ds) => `
        <div class="kpi-card">
          <div class="kpi-label">${esc(ds.destination_type.replace(/_/g, ' '))}</div>
          <div class="kpi-value">${fmtNum(ds.count)}</div>
          <div class="kpi-foot">${fmtNum(ds.total_weight_kg, 2)} kg · ${fmtINR(ds.total_value_inr)}</div>
        </div>`
        )
        .join('')}
    </div>

    <div id="comp-lineage-drawer"></div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Component-Level Traceability Registry</h3>
          <p class="card-subtitle">Powered by <code>vw_component_full_lineage</code> & Recursive CTE sub-assembly queries</p>
        </div>
      </div>

      <div class="filter-bar">
        <input type="text" id="cmp-search" placeholder="Search component UID, source device, type, target reuse device..." style="min-width:270px;" />
        <select id="cmp-dest">
          <option value="">All Destinations</option>
          <option value="REUSE">REUSE</option>
          <option value="RESALE">RESALE</option>
          <option value="REPAIR">REPAIR</option>
          <option value="RECYCLING">RECYCLING</option>
          <option value="HAZARDOUS_DISPOSAL">HAZARDOUS DISPOSAL</option>
        </select>
        <select id="cmp-cond">
          <option value="">All Conditions</option>
          <option value="WORKING">WORKING</option>
          <option value="REPAIRABLE">REPAIRABLE</option>
          <option value="DAMAGED_RECYCLABLE">DAMAGED RECYCLABLE</option>
          <option value="HAZARDOUS_INTACT">HAZARDOUS INTACT</option>
        </select>
        <button class="btn btn-secondary" id="btn-filter-cmp">Filter Components</button>
      </div>

      <div class="table-wrap" id="cmp-table-wrap"></div>
    </div>
  `;

  function drawTable(rows) {
    const wrap = document.getElementById('cmp-table-wrap');
    if (rows.length === 0) {
      wrap.innerHTML = `<div class="empty-state">No harvested components match your filter.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Component UID</th>
            <th>Component Type</th>
            <th>Origin Device</th>
            <th>Parent Sub-Assy</th>
            <th>Condition</th>
            <th>Mass</th>
            <th>Value</th>
            <th>Destination</th>
            <th>Current Status</th>
            <th>Final Downstream Link</th>
            <th>Lineage</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (c) => `
            <tr>
              <td class="mono"><strong>${esc(c.component_uid)}</strong></td>
              <td>${esc(c.component_type_name)}<div class="card-subtitle">${esc(c.component_group)}</div></td>
              <td><a class="link-code mono" href="#/devices/${esc(c.source_device_tracking_no)}">${esc(c.source_device_tracking_no)}</a><div class="card-subtitle">${esc(c.source_device_brand)} ${esc(c.source_device_model)}</div></td>
              <td class="mono">${esc(c.parent_component_uid || '—')}</td>
              <td>${statusBadge(c.condition_status)}</td>
              <td>${fmtNum(c.weight_kg, 3)} kg</td>
              <td>${fmtINR(c.estimated_value_inr)}</td>
              <td><span class="badge badge-slate">${esc(c.destination_type)}</span></td>
              <td>${statusBadge(c.current_status)}</td>
              <td>
                ${
                  c.target_reuse_device_tracking_no
                    ? `Reused in <a class="link-code mono" href="#/devices/${esc(c.target_reuse_device_tracking_no)}">${esc(c.target_reuse_device_tracking_no)}</a>`
                    : c.hazardous_manifest_number
                    ? `TSDF <span class="mono">${esc(c.hazardous_manifest_number)}</span>`
                    : esc(c.recycling_facility_name || c.destination_notes || 'In circular stock')
                }
              </td>
              <td>
                <button class="btn btn-secondary btn-sm btn-inspect-lineage" data-uid="${esc(c.component_uid)}">Recursive Tree</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('.btn-inspect-lineage').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uid = btn.getAttribute('data-uid');
        try {
          const lin = await window.ReLoopAPI.get(`/api/components/${encodeURIComponent(uid)}/lineage`);
          const drawer = document.getElementById('comp-lineage-drawer');
          drawer.innerHTML = `
            <div class="card" style="border-color:var(--brand-500);">
              <div class="card-header">
                <div>
                  <h3 class="card-title">Recursive CTE Lineage Tree for <span class="mono">${esc(lin.component.component_uid)}</span></h3>
                  <p class="card-subtitle">Origin Device: <strong>${esc(lin.component.source_device_tracking_no)}</strong> (${esc(lin.component.source_device_brand)} ${esc(lin.component.source_device_model)}) · Dismantling: <span class="mono">${esc(lin.component.dismantling_code)}</span></p>
                </div>
                <button class="btn btn-secondary btn-sm" id="btn-close-lineage">Close</button>
              </div>
              ${lin.lineage_tree
                .map(
                  (node) => `
                <div class="lineage-node" style="margin-left:${(node.depth - 1) * 28}px;">
                  <strong class="mono">${esc(node.path)}</strong> — ${esc(node.component_type_name)}
                  ${statusBadge(node.current_status)}
                  <div class="card-subtitle">
                    Destination: <strong>${esc(node.destination_type)}</strong>
                    ${node.target_reuse_device_tracking_no ? ` · Installed into Refurbished Device <strong>${esc(node.target_reuse_device_tracking_no)}</strong>` : ''}
                    ${node.recycling_facility_name ? ` · Processed at <strong>${esc(node.recycling_facility_name)}</strong>` : ''}
                  </div>
                </div>`
                )
                .join('')}
            </div>
          `;
          document.getElementById('btn-close-lineage').addEventListener('click', () => {
            drawer.innerHTML = '';
          });
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  drawTable(initial.components);

  document.getElementById('btn-filter-cmp').addEventListener('click', async () => {
    const p = new URLSearchParams();
    const s = document.getElementById('cmp-search').value.trim();
    const d = document.getElementById('cmp-dest').value;
    const c = document.getElementById('cmp-cond').value;
    if (s) p.set('search', s);
    if (d) p.set('destination_type', d);
    if (c) p.set('condition_status', c);
    const res = await window.ReLoopAPI.get(`/api/components?${p.toString()}`);
    drawTable(res.components);
  });
};

// Page 10: Material Recovery (Workflow 5)
window.ReLoopPages.renderMaterials = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge, toast } = window.ReLoopUI;
  const data = await window.ReLoopAPI.get('/api/materials');

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h3 class="card-title">Workflow 5: Record Extracted Raw Material Lot</h3>
        <p class="card-subtitle" style="margin-bottom:14px;">Enforces M:N <code>facility_accepted_materials</code> licensing before inserting recovery batch</p>
        <form id="form-mat-recover">
          <div class="form-group">
            <label>Source Dismantled / Recycling Device *</label>
            <select id="mat-device-id" required>
              ${data.eligible_devices
                .map(
                  (d) =>
                    `<option value="${d.device_id}">${esc(d.tracking_number)} — ${esc(d.brand)} ${esc(d.model_name)} [${d.current_status}]</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Recovered Material Fraction *</label>
              <select id="mat-material-id" required>
                ${data.materials_catalog
                  .map(
                    (m) =>
                      `<option value="${m.material_id}">${esc(m.name)} (${esc(m.material_code)}) — ${fmtINR(m.market_value_per_kg_inr)}/kg</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Licensed Recycling Facility *</label>
              <select id="mat-facility-id" required></select>
            </div>
            <div class="form-group">
              <label>Recovered Weight (kg) *</label>
              <input type="number" id="mat-weight" step="0.0001" min="0.0005" value="0.4500" required />
            </div>
            <div class="form-group">
              <label>Assayed Purity %</label>
              <input type="number" id="mat-purity" step="0.1" min="1" max="100" value="97.5" />
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
            <input type="checkbox" id="mat-mark-recycled" checked />
            <span>Mark source device status as <code>RECYCLED</code> upon recovery verification</span>
          </label>
          <button type="submit" class="btn btn-primary">Record Material Recovery Lot</button>
        </form>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom:12px;">Material Recovery Yield & CO₂ Savings by Element</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Class</th>
                <th>Lots</th>
                <th>Total Mass</th>
                <th>CO₂ Offset</th>
              </tr>
            </thead>
            <tbody>
              ${data.material_summary
                .map(
                  (ms) => `
                <tr>
                  <td><strong>${esc(ms.material_name)}</strong></td>
                  <td><span class="badge badge-slate">${esc(ms.material_class.replace(/_/g, ' '))}</span></td>
                  <td>${fmtNum(ms.lot_count)}</td>
                  <td><strong>${fmtNum(ms.total_kg, 3)} kg</strong></td>
                  <td>${fmtNum(ms.co2_saved_kg, 2)} kg</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Material Recovery Shipment Ledger (${data.records.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Lot No.</th>
              <th>Source Device</th>
              <th>Material</th>
              <th>Mass (kg)</th>
              <th>Purity</th>
              <th>Market Value</th>
              <th>Recycling Facility</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.records
              .map(
                (r) => `
              <tr>
                <td class="mono">${esc(r.lot_number)}</td>
                <td><a class="link-code mono" href="#/devices/${esc(r.tracking_number)}">${esc(r.tracking_number)}</a><div class="card-subtitle">${esc(r.source_device_name)}</div></td>
                <td>${esc(r.material_name)} ${r.is_hazardous ? '<span class="badge badge-red">HAZ</span>' : ''}</td>
                <td><strong>${fmtNum(r.recovered_weight_kg, 4)} kg</strong></td>
                <td>${fmtNum(r.purity_grade_pct, 1)}%</td>
                <td>${fmtINR(r.lot_value_inr)}</td>
                <td>${esc(r.facility_name)}</td>
                <td>${statusBadge(r.recycling_status)}</td>
                <td>${fmtDate(r.recovery_date)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const matSelect = document.getElementById('mat-material-id');
  const facSelect = document.getElementById('mat-facility-id');

  function syncLicensedFacilities() {
    const selectedMat = data.materials_catalog.find((m) => m.material_id === Number(matSelect.value));
    const list = (selectedMat && selectedMat.accepted_facilities) || [];
    facSelect.innerHTML = list
      .map(
        (f) =>
          `<option value="${f.facility_id}">${esc(f.facility_name)} (Efficiency: ${f.recovery_efficiency_pct}%)</option>`
      )
      .join('');
  }
  matSelect.addEventListener('change', syncLicensedFacilities);
  syncLicensedFacilities();

  document.getElementById('form-mat-recover').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const lot = await window.ReLoopAPI.post('/api/materials/recover', {
        source_device_id: Number(document.getElementById('mat-device-id').value),
        material_id: Number(matSelect.value),
        facility_id: Number(facSelect.value),
        recovered_weight_kg: Number(document.getElementById('mat-weight').value),
        purity_grade_pct: Number(document.getElementById('mat-purity').value),
        mark_device_recycled: document.getElementById('mat-mark-recycled').checked,
      });
      toast(`Material recovery lot ${lot.lot_number} recorded!`);
      window.ReLoopPages.renderMaterials(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
};

// Page 11: Certified Recycling Facilities
window.ReLoopPages.renderFacilities = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, toast } = window.ReLoopUI;
  const data = await window.ReLoopAPI.get('/api/recycling/facilities');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Certified Downstream Recycling & TSDF Facilities</h3>
          <p class="card-subtitle">Displays M:N <code>facility_accepted_materials</code> licensing & <code>vw_facility_performance_metrics</code></p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Facility & CPCB License</th>
              <th>Type</th>
              <th>Haz Auth</th>
              <th>Accepted Materials (M:N)</th>
              <th>Capacity / Mo</th>
              <th>Recovered Mass</th>
              <th>Economic Value</th>
              <th>License Valid Until</th>
            </tr>
          </thead>
          <tbody>
            ${data.facilities
              .map(
                (f) => `
              <tr>
                <td class="mono">${esc(f.facility_code)}</td>
                <td>
                  <strong>${esc(f.facility_name)}</strong>
                  <div class="card-subtitle mono">${esc(f.certification_number)} · ${esc(f.city)}, ${esc(f.state)}</div>
                </td>
                <td><span class="badge badge-slate">${esc(f.facility_type.replace(/_/g, ' '))}</span></td>
                <td>${f.authorized_for_hazardous ? '<span class="badge badge-red">TSDF AUTHORIZED</span>' : '<span class="badge badge-blue">NON-HAZ</span>'}</td>
                <td>
                  ${f.accepted_materials
                    .map((m) => `<span class="badge badge-green" style="margin:2px;">${esc(m.material_code)} (${m.recovery_efficiency_pct}%)</span>`)
                    .join('')}
                </td>
                <td>${fmtNum(f.processing_capacity_tons_month, 0)} tons</td>
                <td><strong>${fmtNum(f.total_recovered_kg, 2)} kg</strong></td>
                <td>${fmtINR(f.recovered_value_inr)}</td>
                <td>${fmtDate(f.license_valid_until)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Register Certified Partner Recycling / TSDF Facility</h3>
      <form id="form-new-facility">
        <div class="form-grid">
          <div class="form-group">
            <label>Facility Name *</label>
            <input type="text" id="fac-name" required placeholder="e.g., Northern Circular Metals Ltd" />
          </div>
          <div class="form-group">
            <label>Facility Classification *</label>
            <select id="fac-type">
              <option value="METAL_SMELTER">METAL SMELTER</option>
              <option value="PRECIOUS_METAL_REFINERY">PRECIOUS METAL REFINERY</option>
              <option value="BATTERY_HYDROMETALLURGY">BATTERY HYDROMETALLURGY</option>
              <option value="POLYMER_RECYCLER">POLYMER RECYCLER</option>
              <option value="AUTHORIZED_TSDF_HAZARDOUS">AUTHORIZED TSDF HAZARDOUS</option>
              <option value="INTEGRATED_EWASTE_PLANT">INTEGRATED EWASTE PLANT</option>
            </select>
          </div>
          <div class="form-group">
            <label>CPCB / SPCB Authorization No. (Unique) *</label>
            <input type="text" id="fac-cert" required placeholder="HSPCB/EW/2026-9901" />
          </div>
          <div class="form-group">
            <label>License Valid Until *</label>
            <input type="date" id="fac-valid" value="2029-12-31" required />
          </div>
          <div class="form-group">
            <label>City *</label>
            <input type="text" id="fac-city" value="Gurugram" required />
          </div>
          <div class="form-group">
            <label>State *</label>
            <input type="text" id="fac-state" value="Haryana" required />
          </div>
          <div class="form-group">
            <label>Monthly Capacity (Tons) *</label>
            <input type="number" id="fac-cap" min="10" value="300" required />
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <input type="checkbox" id="fac-haz" />
          <span>Authorized Hazardous Waste Treatment, Storage & Disposal Facility (TSDF)</span>
        </label>
        <button type="submit" class="btn btn-primary">Register Certified Facility</button>
      </form>
    </div>
  `;

  document.getElementById('form-new-facility').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const created = await window.ReLoopAPI.post('/api/recycling/facilities', {
        name: document.getElementById('fac-name').value,
        facility_type: document.getElementById('fac-type').value,
        certification_number: document.getElementById('fac-cert').value,
        license_valid_until: document.getElementById('fac-valid').value,
        city: document.getElementById('fac-city').value,
        state: document.getElementById('fac-state').value,
        processing_capacity_tons_month: Number(document.getElementById('fac-cap').value),
        authorized_for_hazardous: document.getElementById('fac-haz').checked,
        accepted_material_ids: data.materials.slice(0, 3).map((m) => m.material_id),
      });
      toast(`Registered facility ${created.facility_code} (${created.name})!`);
      window.ReLoopPages.renderFacilities(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
};

// Page 12: Hazardous Waste Disposal Records (Workflow 6B)
window.ReLoopPages.renderDisposal = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge, toast } = window.ReLoopUI;
  const data = await window.ReLoopAPI.get('/api/disposal');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Workflow 6B: Authorized Hazardous Waste Disposal Manifest</h3>
          <p class="card-subtitle">Guarded by PostgreSQL trigger <code>trg_validate_hazardous_disposal_facility</code> (rejects non-TSDF or expired facilities!)</p>
        </div>
      </div>

      ${
        data.candidate_devices.length === 0
          ? `<div class="empty-state">No eligible devices currently awaiting hazardous disposal.</div>`
          : `
        <form id="form-disposal">
          <div class="form-grid">
            <div class="form-group">
              <label>Target Device *</label>
              <select id="disp-device-id" required>
                ${data.candidate_devices
                  .map(
                    (d) =>
                      `<option value="${d.device_id}" data-w="${d.weight_kg}">${esc(d.tracking_number)} — ${esc(d.brand)} ${esc(d.model_name)} [${d.current_status}]</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Receiving Treatment Facility (TSDF Guarded) *</label>
              <select id="disp-facility-id" required>
                ${data.facilities
                  .map(
                    (f) =>
                      `<option value="${f.facility_id}">${esc(f.name)} ${f.authorized_for_hazardous ? '✓ [TSDF AUTHORIZED]' : '✗ [NON-HAZ — Tests Trigger Rejection]'}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Treatment Method *</label>
              <select id="disp-method">
                <option value="CHEMICAL_NEUTRALIZATION">CHEMICAL NEUTRALIZATION</option>
                <option value="SECURE_LANDFILL_ENCAPSULATION">SECURE LANDFILL ENCAPSULATION</option>
                <option value="HIGH_TEMP_INCINERATION">HIGH TEMP INCINERATION</option>
                <option value="AUTOCLAVE_IMMOBILIZATION">AUTOCLAVE IMMOBILIZATION</option>
              </select>
            </div>
            <div class="form-group">
              <label>Hazardous Mass (kg) *</label>
              <input type="number" id="disp-weight" step="0.01" min="0.05" value="2.40" required />
            </div>
            <div class="form-group">
              <label>Hazard Classification *</label>
              <input type="text" id="disp-class" value="Swollen Lithium-Ion / Heavy Metal Leachate Risk" required />
            </div>
            <div class="form-group">
              <label>TSDF Treatment Cost (INR)</label>
              <input type="number" id="disp-cost" min="0" value="1450" />
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <input type="checkbox" id="disp-mark-disposed" checked />
            <span>Transition device lifecycle state to <code>DISPOSED</code> with Form-10 certificate</span>
          </label>
          <button type="submit" class="btn btn-primary">Issue Hazardous Disposal Manifest</button>
        </form>`
      }
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Hazardous Waste Disposal & Compliance Registry (${data.disposal_records.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Manifest No.</th>
              <th>Device / Component</th>
              <th>Hazard Classification</th>
              <th>Treatment Method</th>
              <th>Mass</th>
              <th>TSDF Facility</th>
              <th>Compliance Cert</th>
              <th>Cost</th>
              <th>Disposed At</th>
            </tr>
          </thead>
          <tbody>
            ${data.disposal_records
              .map(
                (dr) => `
              <tr>
                <td class="mono"><strong>${esc(dr.manifest_number)}</strong></td>
                <td>
                  <a class="link-code mono" href="#/devices/${esc(dr.tracking_number)}">${esc(dr.tracking_number)}</a>
                  ${dr.component_uid ? `<div class="card-subtitle mono">Comp: ${esc(dr.component_uid)}</div>` : `<div class="card-subtitle">${esc(dr.device_name)}</div>`}
                </td>
                <td>${esc(dr.hazard_classification)}</td>
                <td><span class="badge badge-red">${esc(dr.treatment_method.replace(/_/g, ' '))}</span></td>
                <td>${fmtNum(dr.hazard_weight_kg, 3)} kg</td>
                <td>${esc(dr.facility_name)}</td>
                <td class="mono">${esc(dr.compliance_certificate_no)}</td>
                <td>${fmtINR(dr.disposal_cost_inr)}</td>
                <td>${fmtDate(dr.disposed_at)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const form = document.getElementById('form-disposal');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const created = await window.ReLoopAPI.post('/api/disposal', {
          device_id: Number(document.getElementById('disp-device-id').value),
          facility_id: Number(document.getElementById('disp-facility-id').value),
          treatment_method: document.getElementById('disp-method').value,
          hazard_weight_kg: Number(document.getElementById('disp-weight').value),
          hazard_classification: document.getElementById('disp-class').value,
          disposal_cost_inr: Number(document.getElementById('disp-cost').value || 0),
          mark_device_disposed: document.getElementById('disp-mark-disposed').checked,
        });
        toast(`Issued TSDF manifest ${created.manifest_number} (${created.compliance_certificate_no})!`);
        window.ReLoopPages.renderDisposal(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
};
