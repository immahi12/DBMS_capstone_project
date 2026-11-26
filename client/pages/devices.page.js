window.ReLoopPages = window.ReLoopPages || {};

const ALL_STATUSES = [
  'REGISTERED',
  'COLLECTED',
  'UNDER_INSPECTION',
  'REPAIRABLE',
  'UNDER_REPAIR',
  'REFURBISHED',
  'READY_FOR_REUSE',
  'UNDER_DISMANTLING',
  'DISMANTLED',
  'UNDER_RECYCLING',
  'RECYCLED',
  'DISPOSED',
];

// Page 3: Device Management
window.ReLoopPages.renderDeviceList = async function (container) {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge } = window.ReLoopUI;
  const meta = await window.ReLoopAPI.get('/api/collections/meta');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Electronic Waste Asset Registry</h3>
          <p class="card-subtitle">Querying <code>vw_device_master_overview</code> with parameterized filters & composite indexes</p>
        </div>
        <a href="#/devices/new" class="btn btn-primary">+ Register New E-Waste Device</a>
      </div>

      <div class="filter-bar">
        <input type="text" id="flt-search" placeholder="Search tracking ID, brand, model, serial, donor..." style="min-width:260px;" />
        <select id="flt-status">
          <option value="">All Lifecycle Statuses</option>
          ${ALL_STATUSES.map((s) => `<option value="${s}">${s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
        <select id="flt-category">
          <option value="">All Categories</option>
          ${meta.categories.map((c) => `<option value="${c.category_id}">${esc(c.full_path)}</option>`).join('')}
        </select>
        <select id="flt-center">
          <option value="">All Collection Hubs</option>
          ${meta.centers.map((c) => `<option value="${c.center_id}">${esc(c.name)}</option>`).join('')}
        </select>
        <select id="flt-haz">
          <option value="">Any Hazard Profile</option>
          <option value="true">Hazardous Material Only</option>
          <option value="false">Non-Hazardous Only</option>
        </select>
        <button class="btn btn-secondary" id="btn-apply-device-filter">Apply Filters</button>
      </div>

      <div class="table-wrap" id="devices-table-holder">
        <p class="card-subtitle">Loading devices...</p>
      </div>
    </div>
  `;

  async function loadTable() {
    const params = new URLSearchParams();
    const s = document.getElementById('flt-search').value.trim();
    const st = document.getElementById('flt-status').value;
    const cat = document.getElementById('flt-category').value;
    const ctr = document.getElementById('flt-center').value;
    const haz = document.getElementById('flt-haz').value;

    if (s) params.set('search', s);
    if (st) params.set('status', st);
    if (cat) params.set('category_id', cat);
    if (ctr) params.set('center_id', ctr);
    if (haz) params.set('hazardous', haz);

    const rows = await window.ReLoopAPI.get(`/api/devices?${params.toString()}`);
    const holder = document.getElementById('devices-table-holder');

    if (rows.length === 0) {
      holder.innerHTML = `<div class="empty-state">No electronic devices match the selected criteria.</div>`;
      return;
    }

    holder.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Tracking ID</th>
            <th>Device Asset</th>
            <th>Category</th>
            <th>Donor / Batch</th>
            <th>Current Hub</th>
            <th>Mass</th>
            <th>Est. Value</th>
            <th>Hazard</th>
            <th>Lifecycle Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (d) => `
            <tr>
              <td><a class="link-code mono" href="#/devices/${esc(d.tracking_number)}">${esc(d.tracking_number)}</a></td>
              <td>
                <strong>${esc(d.brand)} ${esc(d.model_name)}</strong>
                <div class="card-subtitle mono">${esc(d.serial_number || 'No Serial')}</div>
              </td>
              <td>${esc(d.category_name)}</td>
              <td>
                ${esc(d.source_organization_name)}
                <div class="card-subtitle mono">${esc(d.batch_number)} · ${fmtDate(d.collection_date)}</div>
              </td>
              <td>${esc(d.current_center_name)}</td>
              <td>${fmtNum(d.weight_kg, 2)} kg</td>
              <td>${fmtINR(d.estimated_value_inr)}</td>
              <td>${d.contains_hazardous_materials ? '<span class="badge badge-red">HAZARDOUS</span>' : '<span class="badge badge-slate">STD</span>'}</td>
              <td>${statusBadge(d.current_status)}</td>
              <td>
                <a class="btn btn-secondary btn-sm" href="#/devices/${esc(d.tracking_number)}">Manage</a>
                <a class="btn btn-secondary btn-sm" href="#/traceability/${esc(d.tracking_number)}">Trace</a>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('btn-apply-device-filter').addEventListener('click', loadTable);
  document.getElementById('flt-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadTable();
  });

  await loadTable();
};

// Page 4: Register New Device (Workflow 1)
window.ReLoopPages.renderRegisterDevice = async function (container) {
  const { esc, toast } = window.ReLoopUI;
  const meta = await window.ReLoopAPI.get('/api/collections/meta');
  const leafCats = meta.categories.filter((c) => c.depth >= 2);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Workflow 1: Register & Collect New Electronic Device</h3>
          <p class="card-subtitle">Executes inside an ACID PostgreSQL transaction creating batch/device & initial lifecycle ledger records</p>
        </div>
        <a href="#/devices" class="btn btn-secondary">← Back to Device Registry</a>
      </div>

      <form id="form-register-device">
        <div class="callout">
          Choose an existing Collection Batch manifest or switch to <strong>Create New Intake Batch</strong> to register a fresh pickup from an organization or citizen drop-off.
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label>Intake Batch Mode</label>
            <select id="reg-batch-mode">
              <option value="existing">Attach to Existing Collection Batch</option>
              <option value="new">Create New Collection Batch Manifest</option>
            </select>
          </div>

          <div class="form-group" id="grp-existing-batch">
            <label>Existing Collection Batch *</label>
            <select id="reg-collection-id">
              ${meta.batches
                .map(
                  (b) =>
                    `<option value="${b.collection_id}">${esc(b.batch_number)} — ${esc(b.organization_name)} (${esc(b.center_name)})</option>`
                )
                .join('')}
            </select>
          </div>

          <div class="form-group" id="grp-new-center" style="display:none;">
            <label>Receiving Collection Center *</label>
            <select id="reg-center-id">
              ${meta.centers
                .filter((c) => c.operating_status === 'ACTIVE')
                .map((c) => `<option value="${c.center_id}">${esc(c.name)} (${esc(c.city)})</option>`)
                .join('')}
            </select>
          </div>

          <div class="form-group" id="grp-new-org" style="display:none;">
            <label>Source Donor Organization</label>
            <select id="reg-org-id">
              <option value="">Individual Citizen Walk-In</option>
              ${meta.organizations.map((o) => `<option value="${o.organization_id}">${esc(o.name)} (${esc(o.org_type)})</option>`).join('')}
            </select>
          </div>

          <div class="form-group" id="grp-new-source-type" style="display:none;">
            <label>Collection Source Channel *</label>
            <select id="reg-source-type">
              <option value="CORPORATE_BULK">CORPORATE BULK</option>
              <option value="CAMPUS_COLLECTION">CAMPUS COLLECTION</option>
              <option value="MUNICIPAL_DRIVE">MUNICIPAL DRIVE</option>
              <option value="RETAIL_TAKEBACK">RETAIL TAKEBACK</option>
              <option value="INDIVIDUAL_DROP_OFF">INDIVIDUAL DROP OFF</option>
            </select>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border-light);margin:14px 0;" />

        <div class="form-grid">
          <div class="form-group">
            <label>E-Waste Category *</label>
            <select id="reg-category-id" required>
              ${leafCats.map((c) => `<option value="${c.category_id}">${esc(c.full_path)} [${c.hazard_level}]</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Brand / Manufacturer *</label>
            <input type="text" id="reg-brand" placeholder="e.g., Dell, Lenovo, Apple, APC" required />
          </div>

          <div class="form-group">
            <label>Model Name *</label>
            <input type="text" id="reg-model" placeholder="e.g., ThinkPad T14 Gen 3" required />
          </div>

          <div class="form-group">
            <label>Manufacturer Serial Number (Unique)</label>
            <input type="text" id="reg-serial" placeholder="e.g., LNV-T14-998812" />
          </div>

          <div class="form-group">
            <label>Manufacture Year</label>
            <input type="number" id="reg-year" min="1990" max="2027" value="2021" />
          </div>

          <div class="form-group">
            <label>Physical Weight (kg) *</label>
            <input type="number" id="reg-weight" step="0.001" min="0.01" value="1.45" required />
          </div>

          <div class="form-group">
            <label>Estimated Residual Value (INR)</label>
            <input type="number" id="reg-value" step="10" min="0" value="12500" />
          </div>

          <div class="form-group">
            <label>Initial Visual Condition Grade</label>
            <select id="reg-grade">
              <option value="GRADE_B">GRADE B (Moderate Wear)</option>
              <option value="GRADE_A">GRADE A (Clean / Working)</option>
              <option value="GRADE_C">GRADE C (Heavy Wear)</option>
              <option value="NON_FUNCTIONAL">NON FUNCTIONAL</option>
              <option value="HAZARDOUS">HAZARDOUS</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>Intake & Provenance Notes</label>
          <textarea id="reg-notes" rows="2" placeholder="Condition remarks at intake dock..."></textarea>
        </div>

        <div style="display:flex;gap:24px;margin:12px 0 18px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="reg-hazardous" />
            <span>Contains Regulated Hazardous Sub-Assemblies (Li-Ion Battery / Leaded Glass / Mercury)</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="reg-autocollect" checked />
            <span>Verify physical receipt immediately (Transition <code>REGISTERED → COLLECTED</code>)</span>
          </label>
        </div>

        <button type="submit" class="btn btn-primary">Register Electronic Device</button>
      </form>
    </div>
  `;

  const modeEl = document.getElementById('reg-batch-mode');
  modeEl.addEventListener('change', () => {
    const isNew = modeEl.value === 'new';
    document.getElementById('grp-existing-batch').style.display = isNew ? 'none' : '';
    document.getElementById('grp-new-center').style.display = isNew ? '' : 'none';
    document.getElementById('grp-new-org').style.display = isNew ? '' : 'none';
    document.getElementById('grp-new-source-type').style.display = isNew ? '' : 'none';
  });

  document.getElementById('form-register-device').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isNew = modeEl.value === 'new';
    try {
      const created = await window.ReLoopAPI.post('/api/devices', {
        create_new_batch: isNew,
        collection_id: isNew ? null : Number(document.getElementById('reg-collection-id').value),
        center_id: isNew ? Number(document.getElementById('reg-center-id').value) : null,
        source_organization_id: isNew ? document.getElementById('reg-org-id').value || null : null,
        source_type: document.getElementById('reg-source-type').value,
        category_id: Number(document.getElementById('reg-category-id').value),
        brand: document.getElementById('reg-brand').value,
        model_name: document.getElementById('reg-model').value,
        serial_number: document.getElementById('reg-serial').value || null,
        manufacture_year: Number(document.getElementById('reg-year').value) || null,
        weight_kg: Number(document.getElementById('reg-weight').value),
        estimated_value_inr: Number(document.getElementById('reg-value').value || 0),
        condition_grade: document.getElementById('reg-grade').value,
        contains_hazardous_materials: document.getElementById('reg-hazardous').checked,
        source_notes: document.getElementById('reg-notes').value,
        auto_collect: document.getElementById('reg-autocollect').checked,
      });
      toast(`Registered ${created.tracking_number} (${created.current_status})!`);
      window.location.hash = `#/devices/${created.tracking_number}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
};

// Page 5: Device 360° Details, Validated Lifecycle Transitions & Transfer
window.ReLoopPages.renderDeviceDetails = async function (container, identifier) {
  const { esc, fmtNum, fmtINR, fmtDate, statusBadge, toast } = window.ReLoopUI;
  const [bundle, meta] = await Promise.all([
    window.ReLoopAPI.get(`/api/devices/${encodeURIComponent(identifier)}/traceability`),
    window.ReLoopAPI.get('/api/collections/meta'),
  ]);

  const d = bundle.device;
  const m = bundle.recovery_metrics || {};

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="mono" style="font-size:18px;font-weight:800;color:var(--brand-900);">${esc(d.tracking_number)}</span>
            ${statusBadge(d.current_status)}
            ${d.contains_hazardous_materials ? '<span class="badge badge-red">HAZARDOUS MATERIAL</span>' : ''}
          </div>
          <h2 style="margin:6px 0 2px;font-size:20px;">${esc(d.brand)} ${esc(d.model_name)}</h2>
          <p class="card-subtitle">UUID: <span class="mono">${esc(d.device_uid)}</span> · Serial: <span class="mono">${esc(d.serial_number || 'N/A')}</span> · Category: ${esc(d.category_name)}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="#/traceability/${esc(d.tracking_number)}" class="btn btn-primary">View Full Lineage Timeline</a>
          <a href="#/devices" class="btn btn-secondary">All Devices</a>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:8px;">
        <div class="kpi-card">
          <div class="kpi-label">Device Mass</div>
          <div class="kpi-value">${fmtNum(d.weight_kg, 3)} kg</div>
          <div class="kpi-foot">Batch ${esc(d.batch_number)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Harvested Components</div>
          <div class="kpi-value">${fmtNum(m.extracted_components_count)}</div>
          <div class="kpi-foot">${fmtNum(m.reusable_components_count)} routed to circular reuse</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Materials Recovered</div>
          <div class="kpi-value">${fmtNum(m.materials_recovered_kg, 3)} kg</div>
          <div class="kpi-foot">Mass accounted: ${fmtNum(m.mass_accounted_pct, 1)}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Circular Value & CO₂</div>
          <div class="kpi-value">${fmtINR(m.total_value_recovered_inr)}</div>
          <div class="kpi-foot">${fmtNum(m.estimated_co2_saved_kg, 2)} kg CO₂ saved</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">PostgreSQL State-Machine Transition Guard</h3>
            <p class="card-subtitle">Computed via <code>fn_get_allowed_next_statuses(${d.device_id})</code> & enforced by <code>trg_validate_device_lifecycle_transition</code></p>
          </div>
        </div>
        ${
          bundle.allowed_next_statuses.length === 0
            ? `<div class="callout">Device has reached terminal circular state <strong>${esc(d.current_status)}</strong>. No further transitions apply.</div>`
            : `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Allowed Next State</th>
                  <th>Prerequisite Check</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${bundle.allowed_next_statuses
                  .map(
                    (ns) => `
                  <tr>
                    <td>
                      ${statusBadge(ns.to_status)}
                      <div class="card-subtitle">${esc(ns.rule_description)}</div>
                    </td>
                    <td>
                      ${
                        ns.prerequisite_met
                          ? '<span class="badge badge-green">READY</span>'
                          : `<span class="badge badge-amber">${esc(ns.blocking_reason)}</span>`
                      }
                    </td>
                    <td>
                      <button class="btn btn-primary btn-sm btn-transition-state"
                              data-to="${esc(ns.to_status)}"
                              ${ns.prerequisite_met ? '' : 'title="Clicking tests PostgreSQL trigger rejection!"'}>
                        Transition →
                      </button>
                    </td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Provenance & Inter-Center Chain of Custody</h3>
            <p class="card-subtitle">Current Location: <strong>${esc(d.current_center_name)} (${esc(d.current_center_city)})</strong></p>
          </div>
        </div>
        <p style="margin:0 0 12px;">
          <strong>Donor Source:</strong> ${esc(d.source_organization_name)} (${esc(d.source_type)})<br/>
          <strong>Intake Date:</strong> ${fmtDate(d.collection_date)} · <strong>Registered By:</strong> ${esc(d.registered_by_name)}
        </p>
        <form id="form-transfer-device" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="flex:1;margin-bottom:0;">
            <label>Transfer to Collection Center (<code>CALL sp_transfer_device_between_centers</code>)</label>
            <select id="trf-to-center">
              ${meta.centers
                .filter((c) => c.center_id !== d.current_center_id)
                .map((c) => `<option value="${c.center_id}">${esc(c.name)} (${esc(c.city)})</option>`)
                .join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-secondary">Execute Transfer</button>
        </form>
        ${
          bundle.transfers.length > 0
            ? `<div style="margin-top:12px;font-size:12.5px;">
                <strong>Transfer History:</strong>
                ${bundle.transfers
                  .map(
                    (t) =>
                      `<div class="card-subtitle">• ${esc(t.transfer_code)}: ${esc(t.from_center_name)} → ${esc(t.to_center_name)} (${fmtDate(t.transferred_at)})</div>`
                  )
                  .join('')}
               </div>`
            : ''
        }
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3 class="card-title" style="margin-bottom:10px;">Diagnostic Inspections (${bundle.inspections.length})</h3>
        ${
          bundle.inspections.length === 0
            ? `<div class="empty-state">No inspections recorded yet. <a href="#/inspections">Go to Inspection Workbench</a></div>`
            : bundle.inspections
                .map(
                  (ins) => `
              <div class="lineage-node">
                <div style="display:flex;justify-content:space-between;">
                  <strong class="mono">${esc(ins.inspection_code)}</strong>
                  ${statusBadge(ins.overall_grade)}
                </div>
                <div style="margin:4px 0;">Pathway: <strong>${esc(ins.recommended_pathway)}</strong> · Inspector: ${esc(ins.inspector_name)}</div>
                <div class="card-subtitle">${esc(ins.inspector_summary)}</div>
              </div>`
                )
                .join('')
        }
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom:10px;">Repair & Circular Parts Installed (${bundle.repairs.length})</h3>
        ${
          bundle.repairs.length === 0
            ? `<div class="empty-state">No repair records for this device.</div>`
            : bundle.repairs
                .map(
                  (r) => `
              <div class="lineage-node">
                <div style="display:flex;justify-content:space-between;">
                  <strong class="mono">${esc(r.ticket_number)}</strong>
                  ${statusBadge(r.repair_status)}
                </div>
                <div>Diagnosis: ${esc(r.issue_diagnosis)}</div>
                <div class="card-subtitle">Cost: ${fmtINR(r.actual_cost_inr)} · Resale/Grant Value: ${fmtINR(r.resale_value_inr)} ${r.reuse_organization_name ? '· Recipient: ' + esc(r.reuse_organization_name) : ''}</div>
              </div>`
                )
                .join('')
        }
        ${
          bundle.installed_circular_components.length > 0
            ? `<div class="callout" style="margin-top:10px;">
                <strong>Circular Harvested Parts Installed into this Device:</strong>
                ${bundle.installed_circular_components
                  .map(
                    (cp) =>
                      `<div>• <span class="mono">${esc(cp.component_uid)}</span> (${esc(cp.component_type_name)}) harvested from <a class="link-code mono" href="#/devices/${esc(cp.source_device_tracking_no)}">${esc(cp.source_device_tracking_no)}</a></div>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Harvested Components & Recursive Sub-Assembly Lineage (${bundle.recovered_components_lineage.length})</h3>
          <p class="card-subtitle">${bundle.dismantling ? `Dismantling Record: ${esc(bundle.dismantling.dismantling_code)} (${esc(bundle.dismantling.dismantling_method)})` : 'Device has not been dismantled'}</p>
        </div>
      </div>
      ${
        bundle.recovered_components_lineage.length === 0
          ? `<div class="empty-state">No components harvested from this device.</div>`
          : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Lineage Path</th>
                <th>Component Type</th>
                <th>Condition</th>
                <th>Mass</th>
                <th>Est. Value</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Downstream Link</th>
              </tr>
            </thead>
            <tbody>
              ${bundle.recovered_components_lineage
                .map(
                  (c) => `
                <tr>
                  <td class="mono" style="padding-left:${(c.tree_depth - 1) * 22 + 12}px;">${esc(c.tree_path)}</td>
                  <td>${esc(c.component_type_name)}</td>
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
                        : esc(c.recycling_facility_name || c.destination_notes || '—')
                    }
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  container.querySelectorAll('.btn-transition-state').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const toStatus = btn.getAttribute('data-to');
      try {
        await window.ReLoopAPI.patch(`/api/devices/${d.device_id}/status`, {
          to_status: toStatus,
          notes: `Transitioned via Device Details workbench to ${toStatus}`,
        });
        toast(`Device ${d.tracking_number} transitioned to ${toStatus}`);
        window.ReLoopPages.renderDeviceDetails(container, d.tracking_number);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  document.getElementById('form-transfer-device').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const toCenter = document.getElementById('trf-to-center').value;
      await window.ReLoopAPI.post(`/api/devices/${d.device_id}/transfer`, {
        to_center_id: Number(toCenter),
        vehicle_manifest: 'RLP-EV-FLEET-09',
        notes: 'Inter-hub chain-of-custody transfer',
      });
      toast('Device transferred between collection centers!');
      window.ReLoopPages.renderDeviceDetails(container, d.tracking_number);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
};
