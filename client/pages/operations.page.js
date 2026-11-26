window.ReLoopPages = window.ReLoopPages || {};

// Page 6: Device Inspection Workbench (Workflow 2)
window.ReLoopPages.renderInspections = async function (container) {
  const { esc, fmtNum, fmtDate, statusBadge, toast } = window.ReLoopUI;
  const data = await window.ReLoopAPI.get('/api/inspections');

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Workflow 2: Diagnostic Inspection Workbench</h3>
            <p class="card-subtitle">Transactional insert into <code>inspections</code> + <code>inspection_check_results</code> (with <code>SAVEPOINT</code>) + status transition</p>
          </div>
        </div>
        ${
          data.pending_queue.length === 0
            ? `<div class="empty-state">No devices currently waiting in COLLECTED or UNDER_INSPECTION queue.</div>`
            : `
          <form id="form-inspection">
            <div class="form-group">
              <label>Select Queued Device (${data.pending_queue.length} in queue) *</label>
              <select id="insp-device-id" required>
                ${data.pending_queue
                  .map(
                    (d) =>
                      `<option value="${d.device_id}">${esc(d.tracking_number)} — ${esc(d.brand)} ${esc(d.model_name)} [${d.current_status}]</option>`
                  )
                  .join('')}
              </select>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Physical Enclosure Condition *</label>
                <select id="insp-physical">
                  <option value="MINOR_WEAR">MINOR WEAR</option>
                  <option value="INTACT">INTACT (Mint)</option>
                  <option value="MODERATE_DAMAGE">MODERATE DAMAGE</option>
                  <option value="SEVERE_DAMAGE">SEVERE DAMAGE</option>
                  <option value="SWOLLEN_OR_LEAKING">SWOLLEN OR LEAKING</option>
                </select>
              </div>
              <div class="form-group">
                <label>Operational Boot Status *</label>
                <select id="insp-functional">
                  <option value="HARDWARE_FAULT">HARDWARE FAULT</option>
                  <option value="FULLY_WORKING">FULLY WORKING</option>
                  <option value="PARTIAL_BOOT">PARTIAL BOOT</option>
                  <option value="NO_POWER">NO POWER</option>
                  <option value="UNSAFE_TO_ENERGIZE">UNSAFE TO ENERGIZE</option>
                </select>
              </div>
              <div class="form-group">
                <label>Overall Condition Grade *</label>
                <select id="insp-grade">
                  <option value="GRADE_B">GRADE B</option>
                  <option value="GRADE_A">GRADE A</option>
                  <option value="GRADE_C">GRADE C</option>
                  <option value="NON_FUNCTIONAL">NON FUNCTIONAL</option>
                  <option value="HAZARDOUS">HAZARDOUS</option>
                </select>
              </div>
              <div class="form-group">
                <label>Recommended Circular Pathway *</label>
                <select id="insp-pathway">
                  <option value="REPAIR">REPAIR (→ REPAIRABLE)</option>
                  <option value="DIRECT_REUSE">DIRECT REUSE (→ READY_FOR_REUSE)</option>
                  <option value="DISMANTLE">DISMANTLE (→ UNDER_DISMANTLING)</option>
                  <option value="RECYCLE">RECYCLE (→ UNDER_RECYCLING)</option>
                  <option value="HAZARDOUS_DISPOSAL">HAZARDOUS DISPOSAL (Await TSDF Manifest)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Battery Health % (Optional)</label>
                <input type="number" id="insp-battery" min="0" max="100" step="0.5" placeholder="e.g., 82.5" />
              </div>
            </div>

            <div style="display:flex;gap:18px;margin-bottom:12px;flex-wrap:wrap;">
              <label><input type="checkbox" id="insp-power-on" checked /> Passed DC Power-On Test</label>
              <label><input type="checkbox" id="insp-hazard" /> Acute Chemical / Battery Hazard Detected</label>
            </div>

            <div class="form-group">
              <label>Subsystem Check Metrics (1:N <code>inspection_check_results</code>)</label>
              <div class="form-grid">
                <input type="text" id="chk-1-metric" value="Motherboard Rail: 19.5V OK" placeholder="Motherboard metric" />
                <select id="chk-1-status">
                  <option value="PASS">Logic Board: PASS</option>
                  <option value="DEGRADED">Logic Board: DEGRADED</option>
                  <option value="FAIL">Logic Board: FAIL</option>
                </select>
                <input type="text" id="chk-2-metric" value="SMART Storage & Memory Scan" placeholder="Storage/RAM metric" />
                <select id="chk-2-status">
                  <option value="PASS">Storage/RAM: PASS</option>
                  <option value="DEGRADED">Storage/RAM: DEGRADED</option>
                  <option value="FAIL">Storage/RAM: FAIL</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Inspector Diagnostic Summary *</label>
              <textarea id="insp-summary" rows="2" required placeholder="Detailed technical assessment and circular disposition rationale..."></textarea>
            </div>

            <button type="submit" class="btn btn-primary">Record Inspection & Advance Lifecycle</button>
          </form>`
        }
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom:12px;">Recent Diagnostic Inspections (${data.inspections.length})</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Device</th>
                <th>Grade</th>
                <th>Pathway</th>
                <th>Checks</th>
                <th>Inspector</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${data.inspections
                .slice(0, 18)
                .map(
                  (i) => `
                <tr>
                  <td class="mono">${esc(i.inspection_code)}</td>
                  <td><a class="link-code mono" href="#/devices/${esc(i.tracking_number)}">${esc(i.tracking_number)}</a><div class="card-subtitle">${esc(i.brand)} ${esc(i.model_name)}</div></td>
                  <td>${statusBadge(i.overall_grade)}</td>
                  <td><span class="badge badge-slate">${esc(i.recommended_pathway)}</span></td>
                  <td>${fmtNum(i.checks_count)}</td>
                  <td>${esc(i.inspector_name)}</td>
                  <td>${fmtDate(i.inspected_at)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('form-inspection');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await window.ReLoopAPI.post('/api/inspections', {
          device_id: Number(document.getElementById('insp-device-id').value),
          physical_condition: document.getElementById('insp-physical').value,
          functional_status: document.getElementById('insp-functional').value,
          overall_grade: document.getElementById('insp-grade').value,
          recommended_pathway: document.getElementById('insp-pathway').value,
          battery_health_pct: document.getElementById('insp-battery').value,
          power_on_passed: document.getElementById('insp-power-on').checked,
          hazard_detected: document.getElementById('insp-hazard').checked,
          inspector_summary: document.getElementById('insp-summary').value,
          check_results: [
            {
              subsystem_name: 'Motherboard & Power Rail',
              check_status: document.getElementById('chk-1-status').value,
              measured_metric: document.getElementById('chk-1-metric').value,
            },
            {
              subsystem_name: 'Memory & Storage Bus',
              check_status: document.getElementById('chk-2-status').value,
              measured_metric: document.getElementById('chk-2-metric').value,
            },
          ],
        });
        toast(`Inspection ${res.inspection.inspection_code} saved! Device status → ${res.device_new_status}`);
        window.ReLoopPages.renderInspections(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
};

// Page 7: Repair & Refurbishment Management (Workflow 3)
window.ReLoopPages.renderRepairs = async function (container) {
  const { esc, fmtINR, statusBadge, toast } = window.ReLoopUI;
  const [data, meta] = await Promise.all([
    window.ReLoopAPI.get('/api/repairs'),
    window.ReLoopAPI.get('/api/collections/meta'),
  ]);

  const repairableDevices = data.repair_queue.filter((d) => d.current_status === 'REPAIRABLE');

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h3 class="card-title">Workflow 3: Open Bench Repair Ticket</h3>
        <p class="card-subtitle" style="margin-bottom:14px;">Supports installing circular harvested components from <code>recovered_components</code> inventory!</p>
        ${
          repairableDevices.length === 0
            ? `<div class="empty-state">No devices currently in REPAIRABLE status awaiting ticket creation.</div>`
            : `
          <form id="form-create-repair">
            <div class="form-group">
              <label>REPAIRABLE Device *</label>
              <select id="rep-device-id" required>
                ${repairableDevices
                  .map((d) => `<option value="${d.device_id}">${esc(d.tracking_number)} — ${esc(d.brand)} ${esc(d.model_name)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Circular Spare Component from Harvested Inventory (Optional)</label>
              <select id="rep-spare-comp">
                <option value="">None (Standard bench repair)</option>
                ${data.available_spare_components
                  .map(
                    (c) =>
                      `<option value="${c.recovered_component_id}">${esc(c.component_uid)} — ${esc(c.component_type_name)} [from ${esc(c.harvested_from_device)}] (${fmtINR(c.estimated_value_inr)})</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Estimated Repair Cost (INR)</label>
              <input type="number" id="rep-est-cost" min="0" value="1200" />
            </div>
            <div class="form-group">
              <label>Fault Diagnosis & Repair Plan *</label>
              <textarea id="rep-diagnosis" rows="2" required placeholder="Describe faulty module and refurbishment procedure..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Open Repair Ticket (→ UNDER_REPAIR)</button>
          </form>`
        }
      </div>

      <div class="card">
        <h3 class="card-title">Complete QA or Escalate Active Repair</h3>
        <p class="card-subtitle" style="margin-bottom:14px;">QA-verified completion transitions device to <code>REFURBISHED</code> / <code>READY_FOR_REUSE</code></p>
        ${
          data.repairs.filter((r) => r.repair_status === 'IN_PROGRESS' || r.repair_status === 'OPEN').length === 0
            ? `<div class="empty-state">No active IN_PROGRESS repair tickets.</div>`
            : `
          <form id="form-resolve-repair">
            <div class="form-group">
              <label>Active Repair Ticket *</label>
              <select id="res-repair-id">
                ${data.repairs
                  .filter((r) => r.repair_status === 'IN_PROGRESS' || r.repair_status === 'OPEN')
                  .map(
                    (r) =>
                      `<option value="${r.repair_id}">${esc(r.ticket_number)} — ${esc(r.tracking_number)} (${esc(r.brand)} ${esc(r.model_name)})</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label>Resolution Outcome *</label>
                <select id="res-outcome">
                  <option value="COMPLETED">COMPLETED & QA PASSED (→ REFURBISHED)</option>
                  <option value="UNREPAIRABLE_ESCALATED">UNREPAIRABLE — ESCALATE (→ UNDER_DISMANTLING)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Actual Repair Cost (INR)</label>
                <input type="number" id="res-actual-cost" min="0" value="950" />
              </div>
              <div class="form-group">
                <label>Reuse / Resale Valuation (INR)</label>
                <input type="number" id="res-resale-val" min="0" value="14500" />
              </div>
              <div class="form-group">
                <label>Circular Reuse Recipient Organization</label>
                <select id="res-org-id">
                  <option value="">Direct Secondary Market</option>
                  ${meta.organizations.map((o) => `<option value="${o.organization_id}">${esc(o.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Work Performed & QA Notes</label>
              <input type="text" id="res-actions" value="Replaced module, cleaned thermal assembly, passed 4h burn-in QA" />
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <input type="checkbox" id="res-certify-reuse" checked />
              <span>Immediately certify device <code>READY_FOR_REUSE</code> after refurbishment</span>
            </label>
            <button type="submit" class="btn btn-primary">Submit Repair Resolution</button>
          </form>`
        }
      </div>
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Repair & Refurbishment Ledger (${data.repairs.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Device</th>
              <th>Diagnosis</th>
              <th>Circular Parts Installed</th>
              <th>Actual Cost</th>
              <th>Resale / Grant Value</th>
              <th>Status</th>
              <th>Technician</th>
            </tr>
          </thead>
          <tbody>
            ${data.repairs
              .map(
                (r) => `
              <tr>
                <td class="mono">${esc(r.ticket_number)}</td>
                <td><a class="link-code mono" href="#/devices/${esc(r.tracking_number)}">${esc(r.tracking_number)}</a><div class="card-subtitle">${esc(r.brand)} ${esc(r.model_name)}</div></td>
                <td>${esc(r.issue_diagnosis)}</td>
                <td>
                  ${
                    (r.installed_components || []).length > 0
                      ? r.installed_components.map((c) => `<span class="badge badge-green mono">${esc(c.component_uid)}</span>`).join(' ')
                      : '<span class="card-subtitle">None</span>'
                  }
                </td>
                <td>${fmtINR(r.actual_cost_inr)}</td>
                <td>${fmtINR(r.resale_value_inr)}</td>
                <td>${statusBadge(r.repair_status)}</td>
                <td>${esc(r.technician_name)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const createForm = document.getElementById('form-create-repair');
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const rep = await window.ReLoopAPI.post('/api/repairs', {
          device_id: Number(document.getElementById('rep-device-id').value),
          spare_component_id: document.getElementById('rep-spare-comp').value || null,
          estimated_cost_inr: Number(document.getElementById('rep-est-cost').value || 0),
          issue_diagnosis: document.getElementById('rep-diagnosis').value,
        });
        toast(`Opened repair ticket ${rep.ticket_number}!`);
        window.ReLoopPages.renderRepairs(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const resolveForm = document.getElementById('form-resolve-repair');
  if (resolveForm) {
    resolveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const repId = document.getElementById('res-repair-id').value;
        const rep = await window.ReLoopAPI.patch(`/api/repairs/${repId}/resolve`, {
          outcome: document.getElementById('res-outcome').value,
          actual_cost_inr: Number(document.getElementById('res-actual-cost').value || 0),
          resale_value_inr: Number(document.getElementById('res-resale-val').value || 0),
          reuse_destination_org_id: document.getElementById('res-org-id').value || null,
          repair_actions: document.getElementById('res-actions').value,
          certify_ready_for_reuse: document.getElementById('res-certify-reuse').checked,
        });
        toast(`Repair ticket ${rep.ticket_number} resolved (${rep.repair_status})!`);
        window.ReLoopPages.renderRepairs(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
};

// Page 8: Dismantling Management & Component Harvesting (Workflow 4)
window.ReLoopPages.renderDismantling = async function (container) {
  const { esc, fmtNum, fmtDate, statusBadge, toast } = window.ReLoopUI;
  const data = await window.ReLoopAPI.get('/api/dismantling');

  function compRowTemplate(idx) {
    return `
      <div class="comp-harvest-row" style="display:grid;grid-template-columns:2fr 1.4fr 1fr 1fr 1.4fr auto;gap:8px;margin-bottom:8px;align-items:center;">
        <select class="ch-type">
          ${data.component_catalog
            .map(
              (c) =>
                `<option value="${c.component_type_id}" data-w="${c.typical_weight_kg}" data-v="${c.benchmark_value_inr}">${esc(c.name)} (${c.component_group})</option>`
            )
            .join('')}
        </select>
        <select class="ch-cond">
          <option value="WORKING">WORKING</option>
          <option value="REPAIRABLE">REPAIRABLE</option>
          <option value="DAMAGED_RECYCLABLE" ${idx >= 1 ? 'selected' : ''}>DAMAGED RECYCLABLE</option>
          <option value="HAZARDOUS_INTACT">HAZARDOUS INTACT</option>
        </select>
        <input type="number" class="ch-weight" step="0.001" min="0.005" value="${idx === 0 ? '0.035' : '0.380'}" placeholder="kg" />
        <input type="number" class="ch-val" step="10" min="0" value="${idx === 0 ? '1700' : '850'}" placeholder="INR" />
        <select class="ch-dest">
          <option value="REUSE" ${idx === 0 ? 'selected' : ''}>REUSE</option>
          <option value="RESALE">RESALE</option>
          <option value="REPAIR">REPAIR</option>
          <option value="RECYCLING" ${idx >= 1 ? 'selected' : ''}>RECYCLING</option>
          <option value="HAZARDOUS_DISPOSAL">HAZARDOUS DISPOSAL</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm btn-remove-comp">✕</button>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Workflow 4: Dismantling Workbench & Component-Level Harvesting</h3>
          <p class="card-subtitle">Executes inside a <code>REPEATABLE READ</code> PostgreSQL transaction with <code>SAVEPOINT</code> & 1:1 <code>dismantling_records</code> constraint</p>
        </div>
      </div>

      ${
        data.dismantling_queue.length === 0
          ? `<div class="empty-state">No devices currently in UNDER_DISMANTLING status. Inspect a non-repairable device or escalate an unrepairable ticket first.</div>`
          : `
        <form id="form-dismantle">
          <div class="form-grid">
            <div class="form-group">
              <label>Device in UNDER_DISMANTLING Queue (${data.dismantling_queue.length}) *</label>
              <select id="dism-device-id" required>
                ${data.dismantling_queue
                  .map(
                    (d) =>
                      `<option value="${d.device_id}">${esc(d.tracking_number)} — ${esc(d.brand)} ${esc(d.model_name)} (${fmtNum(d.weight_kg, 2)} kg)</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Dismantling Protocol *</label>
              <select id="dism-method">
                <option value="MANUAL_PRECISION">MANUAL PRECISION TEARDOWN</option>
                <option value="SEMI_AUTOMATED">SEMI-AUTOMATED SEPARATION</option>
                <option value="THERMAL_DEPOPULATION_PREP">THERMAL DEPOPULATION PREP</option>
              </select>
            </div>
            <div class="form-group">
              <label>Residual Non-Component Hull Scrap (kg)</label>
              <input type="number" id="dism-scrap" step="0.01" min="0" value="0.22" />
            </div>
          </div>

          <div style="margin:12px 0 8px;display:flex;justify-content:space-between;align-items:center;">
            <strong>Extracted Physical Components (Component-Level Traceability)</strong>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-comp-row">+ Add Harvested Component</button>
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">
            Columns: Component Catalog Type · Condition · Weight (kg) · Est. Value (INR) · Circular Destination
          </div>
          <div id="harvest-rows-holder">
            ${compRowTemplate(0)}
            ${compRowTemplate(1)}
          </div>

          <div class="form-group" style="margin-top:12px;">
            <label>Dismantling Bench Notes</label>
            <input type="text" id="dism-notes" value="ESD-safe component extraction completed; hazardous battery isolated" />
          </div>

          <button type="submit" class="btn btn-primary">Commit Atomic Dismantling & Harvest Components</button>
        </form>`
      }
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Completed Dismantling Operations (${data.dismantling_records.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dismantling Code</th>
              <th>Source Device</th>
              <th>Method</th>
              <th>Extracted Components</th>
              <th>Residual Scrap</th>
              <th>Device Status</th>
              <th>Operator / Hub</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.dismantling_records
              .map(
                (dr) => `
              <tr>
                <td class="mono">${esc(dr.dismantling_code)}</td>
                <td><a class="link-code mono" href="#/devices/${esc(dr.tracking_number)}">${esc(dr.tracking_number)}</a><div class="card-subtitle">${esc(dr.brand)} ${esc(dr.model_name)}</div></td>
                <td><span class="badge badge-slate">${esc(dr.dismantling_method.replace(/_/g, ' '))}</span></td>
                <td><strong>${fmtNum(dr.total_components_extracted)}</strong> components</td>
                <td>${fmtNum(dr.residual_scrap_kg, 3)} kg</td>
                <td>${statusBadge(dr.device_status)}</td>
                <td>${esc(dr.operator_name)}<div class="card-subtitle">${esc(dr.center_name)}</div></td>
                <td>${fmtDate(dr.dismantled_at)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const holder = document.getElementById('harvest-rows-holder');
  const addBtn = document.getElementById('btn-add-comp-row');
  if (addBtn && holder) {
    addBtn.addEventListener('click', () => {
      holder.insertAdjacentHTML('beforeend', compRowTemplate(2));
    });
    holder.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove-comp')) {
        if (holder.querySelectorAll('.comp-harvest-row').length > 1) {
          e.target.closest('.comp-harvest-row').remove();
        }
      }
    });
  }

  const form = document.getElementById('form-dismantle');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rows = Array.from(holder.querySelectorAll('.comp-harvest-row')).map((r) => ({
        component_type_id: Number(r.querySelector('.ch-type').value),
        condition_status: r.querySelector('.ch-cond').value,
        weight_kg: Number(r.querySelector('.ch-weight').value),
        estimated_value_inr: Number(r.querySelector('.ch-val').value || 0),
        destination_type: r.querySelector('.ch-dest').value,
      }));

      try {
        const res = await window.ReLoopAPI.post('/api/dismantling', {
          device_id: Number(document.getElementById('dism-device-id').value),
          dismantling_method: document.getElementById('dism-method').value,
          residual_scrap_kg: Number(document.getElementById('dism-scrap').value || 0),
          notes: document.getElementById('dism-notes').value,
          components: rows,
        });
        toast(`Dismantling ${res.dismantling.dismantling_code} committed with ${res.recovered_components.length} components!`);
        window.ReLoopPages.renderDismantling(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
};
