process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const { seedDatabase } = require('../src/database/seeds/seed_reloop');

let server;
let baseUrl;

async function apiRequest(method, path, body = null, token = null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function runSuite() {
  const results = [];
  async function test(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      results.push({ name, passed: true, ms });
      console.log(`  ✓ PASS [${ms}ms]: ${name}`);
    } catch (err) {
      const ms = Date.now() - t0;
      results.push({ name, passed: false, ms, error: err.message });
      console.error(`  ✗ FAIL [${ms}ms]: ${name}\n    -> ${err.message}`);
    }
  }

  console.log('======================================================================');
  console.log(' ReLoop DBMS Capstone — Integration, SQL Trigger & Transaction Tests');
  console.log('======================================================================');

  await seedDatabase({ closePool: false });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const tokens = {};
  let repairPipelineDevice;
  let dismantlePipelineDevice;
  let hazardPipelineDevice;

  // 1. Database Connectivity
  await test('1. PostgreSQL 17 connectivity & health probe', async () => {
    const r = await apiRequest('GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'healthy');
    assert.ok(r.body.db.devices_count >= 75);
  });

  // 2. Authentication (Success + Failure)
  await test('2. User authentication (valid bcrypt login across RBAC roles + invalid password rejection)', async () => {
    const bad = await apiRequest('POST', '/api/auth/login', {
      email: 'admin@reloop.io',
      password: 'WrongPassword123',
    });
    assert.strictEqual(bad.status, 401);

    for (const [key, email] of [
      ['admin', 'admin@reloop.io'],
      ['collector', 'collector@reloop.io'],
      ['inspector', 'inspector@reloop.io'],
      ['repair', 'repair@reloop.io'],
      ['recycling', 'recycling@reloop.io'],
    ]) {
      const ok = await apiRequest('POST', '/api/auth/login', {
        email,
        password: 'ReLoop@2026',
      });
      assert.strictEqual(ok.status, 200);
      assert.ok(ok.body.data.token);
      tokens[key] = ok.body.data.token;
    }
  });

  // 3. Role-Based Access Control (RBAC)
  await test('3. Role-based permissions enforcement & RBAC_DENIED audit logging', async () => {
    // Inspector should NOT be allowed to register a new device
    const denied = await apiRequest(
      'POST',
      '/api/devices',
      {
        collection_id: 1,
        category_id: 7,
        brand: 'Asus',
        model_name: 'ExpertBook B9',
        weight_kg: 1.1,
      },
      tokens.inspector
    );
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error.code, 'FORBIDDEN_ROLE');

    const auditCheck = await query(
      `SELECT COUNT(*) AS cnt FROM audit_logs WHERE action_type = 'RBAC_DENIED'`
    );
    assert.ok(auditCheck.rows[0].cnt >= 1);
  });

  // 4. Device Registration (Workflow 1) & Duplicate Tracking ID Test
  await test('4. Device registration workflow & UNIQUE tracking_number constraint enforcement', async () => {
    const reg = await apiRequest(
      'POST',
      '/api/devices',
      {
        tracking_number: 'RLP-TEST-REPAIR-01',
        collection_id: 1,
        category_id: 7,
        brand: 'Lenovo',
        model_name: 'ThinkPad X1 Carbon Gen 9',
        serial_number: 'SN-TEST-X1C-001',
        weight_kg: 1.13,
        estimated_value_inr: 24000,
        auto_collect: true,
      },
      tokens.collector
    );
    assert.strictEqual(reg.status, 201);
    assert.strictEqual(reg.body.data.current_status, 'COLLECTED');
    repairPipelineDevice = reg.body.data;

    // Attempt duplicate tracking_number -> must return 409 DUPLICATE_RECORD
    const dup = await apiRequest(
      'POST',
      '/api/devices',
      {
        tracking_number: 'RLP-TEST-REPAIR-01',
        collection_id: 1,
        category_id: 7,
        brand: 'Lenovo',
        model_name: 'Clone',
        weight_kg: 1.2,
      },
      tokens.collector
    );
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.error.code, 'DUPLICATE_RECORD');
  });

  // 5. Foreign Key Constraint Violation Test
  await test('5. Foreign key integrity violation rejected by PostgreSQL (invalid category_id)', async () => {
    const fkFail = await apiRequest(
      'POST',
      '/api/devices',
      {
        collection_id: 1,
        category_id: 999999,
        brand: 'Dell',
        model_name: 'Ghost Model',
        weight_kg: 1.5,
      },
      tokens.collector
    );
    assert.strictEqual(fkFail.status, 400);
    assert.strictEqual(fkFail.body.error.code, 'FOREIGN_KEY_VIOLATION');
  });

  // 6. Invalid Lifecycle Transitions & Trigger Guard
  await test('6. Invalid lifecycle transitions & missing-evidence transitions blocked by DB trigger', async () => {
    // Attempt illegal jump COLLECTED -> RECYCLED
    const jump = await apiRequest(
      'PATCH',
      `/api/devices/${repairPipelineDevice.device_id}/status`,
      { to_status: 'RECYCLED' },
      tokens.admin
    );
    assert.strictEqual(jump.status, 400);
    assert.strictEqual(jump.body.error.code, 'LIFECYCLE_RULE_VIOLATION');

    // Move COLLECTED -> UNDER_INSPECTION (valid), then try UNDER_INSPECTION -> REPAIRABLE WITHOUT an inspection record!
    const validStep = await apiRequest(
      'PATCH',
      `/api/devices/${repairPipelineDevice.device_id}/status`,
      { to_status: 'UNDER_INSPECTION' },
      tokens.inspector
    );
    assert.strictEqual(validStep.status, 200);

    const noInsp = await apiRequest(
      'PATCH',
      `/api/devices/${repairPipelineDevice.device_id}/status`,
      { to_status: 'REPAIRABLE' },
      tokens.inspector
    );
    assert.strictEqual(noInsp.status, 400);
    assert.match(noInsp.body.error.message, /without a recorded inspection/i);
  });

  // 7. Immutable Lifecycle Ledger Protection
  await test('7. Immutable lifecycle_events history protected against UPDATE and DELETE by trigger', async () => {
    await assert.rejects(
      async () => {
        await query(`DELETE FROM lifecycle_events WHERE device_id = $1`, [
          repairPipelineDevice.device_id,
        ]);
      },
      (err) => err.code === 'P0002'
    );

    await assert.rejects(
      async () => {
        await query(`UPDATE lifecycle_events SET notes = 'Tampered' WHERE device_id = $1`, [
          repairPipelineDevice.device_id,
        ]);
      },
      (err) => err.code === 'P0002'
    );
  });

  // 8. Device Inspection Workflow (Workflow 2)
  await test('8. Device inspection workflow with 1:N subsystem checks & automatic REPAIRABLE transition', async () => {
    const insp = await apiRequest(
      'POST',
      '/api/inspections',
      {
        device_id: repairPipelineDevice.device_id,
        physical_condition: 'MINOR_WEAR',
        functional_status: 'HARDWARE_FAULT',
        power_on_passed: true,
        battery_health_pct: 88.0,
        overall_grade: 'GRADE_B',
        recommended_pathway: 'REPAIR',
        inspector_summary: 'Needs replacement DDR4 module; display & battery excellent.',
        check_results: [
          { subsystem_name: 'Display IPS', check_status: 'PASS', measured_metric: '380 nits' },
          { subsystem_name: 'SODIMM Slot', check_status: 'FAIL', measured_metric: 'ECC fault' },
        ],
      },
      tokens.inspector
    );
    assert.strictEqual(insp.status, 201);
    assert.strictEqual(insp.body.data.device_new_status, 'REPAIRABLE');
  });

  // 9. Repair & Refurbishment Workflow (Workflow 3)
  await test('9. Repair & refurbishment workflow (open ticket -> QA verify -> REFURBISHED -> READY_FOR_REUSE)', async () => {
    const openRep = await apiRequest(
      'POST',
      '/api/repairs',
      {
        device_id: repairPipelineDevice.device_id,
        issue_diagnosis: 'Replace faulty memory module & update firmware',
        estimated_cost_inr: 1400,
      },
      tokens.repair
    );
    assert.strictEqual(openRep.status, 201);

    // Verify DB trigger blocks UNDER_REPAIR -> REFURBISHED before repair ticket is COMPLETED!
    const prematureRefurb = await apiRequest(
      'PATCH',
      `/api/devices/${repairPipelineDevice.device_id}/status`,
      { to_status: 'REFURBISHED' },
      tokens.repair
    );
    assert.strictEqual(prematureRefurb.status, 400);

    // Complete repair & certify READY_FOR_REUSE
    const resolved = await apiRequest(
      'PATCH',
      `/api/repairs/${openRep.body.data.repair_id}/resolve`,
      {
        outcome: 'COMPLETED',
        actual_cost_inr: 1100,
        resale_value_inr: 21500,
        certify_ready_for_reuse: true,
      },
      tokens.repair
    );
    assert.strictEqual(resolved.status, 200);

    const trace = await apiRequest(
      'GET',
      `/api/devices/${repairPipelineDevice.tracking_number}/traceability`,
      null,
      tokens.admin
    );
    assert.strictEqual(trace.body.data.device.current_status, 'READY_FOR_REUSE');
  });

  // 10. Transaction Rollback Verification on Multi-Step Dismantling Failure
  await test('10. ACID Transaction Rollback: failed multi-step dismantling leaves zero partial records', async () => {
    const reg2 = await apiRequest(
      'POST',
      '/api/devices',
      {
        tracking_number: 'RLP-TEST-DISM-01',
        collection_id: 1,
        category_id: 8,
        brand: 'HP',
        model_name: 'ProDesk 600 G5',
        weight_kg: 5.4,
        auto_collect: true,
      },
      tokens.collector
    );
    dismantlePipelineDevice = reg2.body.data;

    await apiRequest(
      'POST',
      '/api/inspections',
      {
        device_id: dismantlePipelineDevice.device_id,
        physical_condition: 'SEVERE_DAMAGE',
        functional_status: 'NO_POWER',
        power_on_passed: false,
        overall_grade: 'NON_FUNCTIONAL',
        recommended_pathway: 'DISMANTLE',
        inspector_summary: ' Flood-damaged board; harvest components.',
      },
      tokens.inspector
    );

    // Attempt dismantling where the 2nd component has an invalid negative weight (-5 kg -> violates CHECK weight_kg > 0)!
    const badDism = await apiRequest(
      'POST',
      '/api/dismantling',
      {
        device_id: dismantlePipelineDevice.device_id,
        dismantling_method: 'MANUAL_PRECISION',
        residual_scrap_kg: 0.4,
        components: [
          {
            component_type_id: 1,
            condition_status: 'WORKING',
            weight_kg: 0.03,
            estimated_value_inr: 1500,
            destination_type: 'REUSE',
          },
          {
            component_type_id: 7,
            condition_status: 'DAMAGED_RECYCLABLE',
            weight_kg: -5.0, // Triggers PostgreSQL CHECK violation mid-transaction!
            estimated_value_inr: 400,
            destination_type: 'RECYCLING',
          },
        ],
      },
      tokens.recycling
    );
    assert.strictEqual(badDism.status, 400);

    // Verify ZERO dismantling_records and ZERO recovered_components were committed!
    const orphanDism = await query('SELECT COUNT(*) AS cnt FROM dismantling_records WHERE device_id = $1', [
      dismantlePipelineDevice.device_id,
    ]);
    const orphanComp = await query('SELECT COUNT(*) AS cnt FROM recovered_components WHERE source_device_id = $1', [
      dismantlePipelineDevice.device_id,
    ]);
    const devState = await query('SELECT current_status FROM devices WHERE device_id = $1', [
      dismantlePipelineDevice.device_id,
    ]);
    assert.strictEqual(orphanDism.rows[0].cnt, 0);
    assert.strictEqual(orphanComp.rows[0].cnt, 0);
    assert.strictEqual(devState.rows[0].current_status, 'UNDER_DISMANTLING');
  });

  // 11. Valid Dismantling, Component Traceability, Material Recovery & Recycling Completion
  await test('11. Dismantling, component traceability, material recovery & RECYCLED state guard', async () => {
    const okDism = await apiRequest(
      'POST',
      '/api/dismantling',
      {
        device_id: dismantlePipelineDevice.device_id,
        dismantling_method: 'MANUAL_PRECISION',
        residual_scrap_kg: 0.45,
        components: [
          {
            component_uid: 'CMP-TEST-RAM-99',
            component_type_id: 1,
            condition_status: 'WORKING',
            weight_kg: 0.03,
            estimated_value_inr: 1650,
            destination_type: 'REUSE',
          },
          {
            component_uid: 'CMP-TEST-MOBO-99',
            component_type_id: 7,
            condition_status: 'DAMAGED_RECYCLABLE',
            weight_kg: 0.48,
            estimated_value_inr: 920,
            destination_type: 'RECYCLING',
          },
        ],
      },
      tokens.recycling
    );
    assert.strictEqual(okDism.status, 201);
    assert.strictEqual(okDism.body.data.dismantling.total_components_extracted, 2);

    // Attempt marking DISMANTLED -> RECYCLED before any material_recovery_records exist -> MUST FAIL!
    const prematureRecycle = await apiRequest(
      'PATCH',
      `/api/devices/${dismantlePipelineDevice.device_id}/status`,
      { to_status: 'RECYCLED' },
      tokens.recycling
    );
    assert.strictEqual(prematureRecycle.status, 400);
    assert.match(prematureRecycle.body.error.message, /without at least one material recovery record/i);

    // Record material recovery at licensed Copper facility (material_id=1 Copper, facility_id=1 Refinery) & mark RECYCLED
    const matRec = await apiRequest(
      'POST',
      '/api/materials/recover',
      {
        source_device_id: dismantlePipelineDevice.device_id,
        material_id: 1,
        facility_id: 1,
        recovered_weight_kg: 0.85,
        purity_grade_pct: 98.7,
        mark_device_recycled: true,
      },
      tokens.recycling
    );
    assert.strictEqual(matRec.status, 201);

    // Verify component lineage & device status
    const compLineage = await apiRequest('GET', '/api/components/CMP-TEST-RAM-99/lineage', null, tokens.admin);
    assert.strictEqual(compLineage.status, 200);
    assert.strictEqual(compLineage.body.data.component.source_device_tracking_no, 'RLP-TEST-DISM-01');
  });

  // 12. Hazardous Disposal TSDF Authorization Trigger Guard & Valid Disposal
  await test('12. Hazardous disposal: non-TSDF facility rejected by DB trigger + authorized TSDF manifest succeeds', async () => {
    const regHaz = await apiRequest(
      'POST',
      '/api/devices',
      {
        tracking_number: 'RLP-TEST-HAZ-01',
        collection_id: 1,
        category_id: 14,
        brand: 'APC',
        model_name: 'Back-UPS Leaking Unit',
        weight_kg: 11.2,
        contains_hazardous_materials: true,
        auto_collect: true,
      },
      tokens.collector
    );
    hazardPipelineDevice = regHaz.body.data;

    await apiRequest(
      'POST',
      '/api/inspections',
      {
        device_id: hazardPipelineDevice.device_id,
        physical_condition: 'SWOLLEN_OR_LEAKING',
        functional_status: 'UNSAFE_TO_ENERGIZE',
        power_on_passed: false,
        hazard_detected: true,
        overall_grade: 'HAZARDOUS',
        recommended_pathway: 'HAZARDOUS_DISPOSAL',
        inspector_summary: 'Leaking acid electrolyte; send to TSDF.',
      },
      tokens.inspector
    );

    // Facility 4 (GreenPoly Polymer Recycler) is NOT authorized_for_hazardous -> Trigger P0003 MUST reject!
    const badTsdf = await apiRequest(
      'POST',
      '/api/disposal',
      {
        device_id: hazardPipelineDevice.device_id,
        facility_id: 4,
        hazard_classification: 'Corrosive Lead-Acid Waste',
        treatment_method: 'CHEMICAL_NEUTRALIZATION',
        hazard_weight_kg: 10.5,
      },
      tokens.recycling
    );
    assert.strictEqual(badTsdf.status, 400);
    assert.strictEqual(badTsdf.body.error.code, 'HAZARDOUS_COMPLIANCE_VIOLATION');

    // Facility 3 (Haryana Enviro TSDF) IS authorized_for_hazardous -> MUST succeed & mark device DISPOSED!
    const okTsdf = await apiRequest(
      'POST',
      '/api/disposal',
      {
        device_id: hazardPipelineDevice.device_id,
        facility_id: 3,
        hazard_classification: 'Corrosive Lead-Acid Waste',
        treatment_method: 'CHEMICAL_NEUTRALIZATION',
        hazard_weight_kg: 10.5,
        mark_device_disposed: true,
      },
      tokens.recycling
    );
    assert.strictEqual(okTsdf.status, 201);

    const checkDev = await query('SELECT current_status FROM devices WHERE device_id = $1', [
      hazardPipelineDevice.device_id,
    ]);
    assert.strictEqual(checkDev.rows[0].current_status, 'DISPOSED');
  });

  // 13. Analytics Dashboard & All 26 Viva SQL Queries Live Verification
  await test('13. Dashboard KPIs & all 26 DBMS Viva SQL Queries execute cleanly via API', async () => {
    const dash = await apiRequest('GET', '/api/analytics/dashboard', null, tokens.admin);
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.data.kpis.total_devices_collected >= 78);

    const vivaList = await apiRequest('GET', '/api/analytics/viva-queries', null, tokens.admin);
    assert.strictEqual(vivaList.body.data.length, 26);

    for (const q of vivaList.body.data) {
      const run = await apiRequest('POST', `/api/analytics/viva-queries/${q.id}/run`, {}, tokens.admin);
      assert.strictEqual(run.status, 200, `Query ${q.id} failed`);
      assert.ok(run.body.data.row_count >= 1, `Query ${q.id} returned 0 rows`);
    }
  });

  // Restore clean canonical seed state so live UI preview starts clean
  await seedDatabase({ closePool: false });

  await new Promise((resolve) => server.close(resolve));
  await pool.end();

  const passedCount = results.filter((r) => r.passed).length;
  console.log('======================================================================');
  console.log(` Test Summary: ${passedCount}/${results.length} Test Suites Passed`);
  console.log('======================================================================');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
