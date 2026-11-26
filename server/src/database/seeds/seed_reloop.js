const bcrypt = require('bcryptjs');
const { pool, setTransitionContext } = require('../../config/database');
const env = require('../../config/env');

function addHours(isoStr, hours) {
  const d = new Date(isoStr);
  d.setTime(d.getTime() + hours * 3600 * 1000);
  return d.toISOString();
}

async function transitionDevice(client, deviceId, toStatus, ctx) {
  await setTransitionContext(client, ctx);
  await client.query(
    'UPDATE devices SET current_status = $1 WHERE device_id = $2',
    [toStatus, deviceId]
  );
}

async function seedDatabase({ closePool = true } = {}) {
  const client = await pool.connect();
  try {
    console.log('[Seed] Starting ReLoop comprehensive database seed...');
    await client.query('BEGIN');

    // Clean existing domain rows in dependency order while keeping schema_migrations & lifecycle_transition_rules
    await client.query(`
      TRUNCATE TABLE
        audit_logs,
        device_transfers,
        disposal_records,
        material_recovery_records,
        facility_accepted_materials,
        component_material_composition,
        recovered_components,
        dismantling_records,
        repair_records,
        inspection_check_results,
        inspections,
        lifecycle_events,
        devices,
        collection_batches,
        recycling_facilities,
        materials,
        component_catalog,
        e_waste_categories,
        users,
        collection_centers,
        organizations
      RESTART IDENTITY CASCADE;
    `);

    // -------------------------------------------------------------------------
    // 1. ORGANIZATIONS (7 realistic partners/donors/recipients)
    // -------------------------------------------------------------------------
    const orgRows = [
      ['ORG-CORP-01', 'Infosys CyberPark Campus', 'CORPORATE', 'Vikramaditya Rao', 'ewaste.desk@infosys-demo.in', '+91-9810112233', 'Gurugram', 'Haryana', 'Sector 48, Sohna Road, Gurugram'],
      ['ORG-CORP-02', 'Tata Digital FinTech Hub', 'CORPORATE', 'Meera Krishnan', 'sustainability@tatadigital-demo.in', '+91-9820445566', 'Bengaluru', 'Karnataka', 'Outer Ring Road, Bellandur, Bengaluru'],
      ['ORG-EDU-03', 'KR Mangalam Tech University', 'EDUCATIONAL', 'Dr. Arvind Sharma', 'it.assets@krmu-demo.edu.in', '+91-9811778899', 'Sohna', 'Haryana', 'Sohna-Gurugram Expressway, Haryana'],
      ['ORG-GOV-04', 'GMDA Smart City Civic Drive', 'GOVERNMENT', 'Rajeshwar Hooda', 'civic.ewaste@gmda-demo.gov.in', '+91-9871223344', 'Gurugram', 'Haryana', 'Sector 32 Institutional Area, Gurugram'],
      ['ORG-RET-05', 'Croma Electronics Takeback', 'RETAIL_PARTNER', 'Nidhi Malhotra', 'takeback@croma-demo.in', '+91-9818556677', 'New Delhi', 'Delhi', 'Okhla Phase III, New Delhi'],
      ['ORG-RES-06', 'Central Park Green Township RWA', 'RESIDENTIAL_COMMUNITY', 'Col. Harpreet Gill', 'rwa@centralpark-demo.org', '+91-9899334455', 'Sohna', 'Haryana', 'Sector 33, Sohna, Haryana'],
      ['ORG-NGO-07', 'VidyaSetu Digital Inclusion Foundation', 'NGO', 'Ananya Deshmukh', 'grants@vidyasetu-demo.org', '+91-9765112200', 'Pune', 'Maharashtra', 'Baner Pashan Link Road, Pune'],
    ];

    const orgIds = {};
    for (const o of orgRows) {
      const res = await client.query(
        `INSERT INTO organizations
          (organization_code, name, org_type, contact_person, contact_email, contact_phone, city, state, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING organization_id`,
        o
      );
      orgIds[o[0]] = res.rows[0].organization_id;
    }

    // -------------------------------------------------------------------------
    // 2. COLLECTION CENTERS (5 hubs; 1 maintenance/low-load hub for outer-join analytics)
    // -------------------------------------------------------------------------
    const centerRows = [
      ['CTR-GGN-01', 'Gurugram Central Circular Hub', 'Gurugram', 'Haryana', 'Plot 14, Udyog Vihar Phase IV, Gurugram', 28.501120, 77.084510, 4500.00, 'ACTIVE'],
      ['CTR-SOH-02', 'Sohna Eco-Tech Intake & Dismantling Center', 'Sohna', 'Haryana', 'IMT Sohna Industrial Sector 8, Haryana', 28.248600, 77.065200, 3200.00, 'ACTIVE'],
      ['CTR-DEL-03', 'Okhla Urban E-Waste Recovery Depot', 'New Delhi', 'Delhi', 'Block B, Okhla Industrial Estate Phase II, New Delhi', 28.535500, 77.273200, 3800.00, 'ACTIVE'],
      ['CTR-BLR-04', 'Bengaluru Electronic City Refurb Lab', 'Bengaluru', 'Karnataka', 'Phase 1, Electronic City, Bengaluru', 12.845200, 77.660200, 5000.00, 'ACTIVE'],
      ['CTR-PUN-05', 'Pune Hinjewadi Satellite Collection Point', 'Pune', 'Maharashtra', 'Phase 2, Hinjewadi IT Park, Pune', 18.591300, 73.738900, 2000.00, 'MAINTENANCE'],
    ];

    const centerIds = {};
    for (const c of centerRows) {
      const res = await client.query(
        `INSERT INTO collection_centers
          (center_code, name, city, state, address, latitude, longitude, storage_capacity_kg, operating_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING center_id`,
        c
      );
      centerIds[c[0]] = res.rows[0].center_id;
    }

    // -------------------------------------------------------------------------
    // 3. USERS (All 5 RBAC Roles, bcrypt hashed password: ReLoop@2026)
    // -------------------------------------------------------------------------
    const passwordHash = await bcrypt.hash('ReLoop@2026', env.bcryptSaltRounds);
    const userRows = [
      ['EMP-001', 'Aarav Mehta', 'admin@reloop.io', 'ADMIN', centerIds['CTR-GGN-01']],
      ['EMP-002', 'Priya Nair', 'collector@reloop.io', 'COLLECTION_MANAGER', centerIds['CTR-SOH-02']],
      ['EMP-003', 'Rohan Kulkarni', 'inspector@reloop.io', 'INSPECTOR', centerIds['CTR-GGN-01']],
      ['EMP-004', 'Sneha Iyer', 'repair@reloop.io', 'REPAIR_OPERATOR', centerIds['CTR-BLR-04']],
      ['EMP-005', 'Kabir Verma', 'recycling@reloop.io', 'RECYCLING_MANAGER', centerIds['CTR-SOH-02']],
      ['EMP-006', 'Devika Sen', 'inspector.del@reloop.io', 'INSPECTOR', centerIds['CTR-DEL-03']],
      ['EMP-007', 'Manish Tiwari', 'collector.del@reloop.io', 'COLLECTION_MANAGER', centerIds['CTR-DEL-03']],
    ];

    const userIds = {};
    for (const u of userRows) {
      const res = await client.query(
        `INSERT INTO users (employee_code, full_name, email, password_hash, role, assigned_center_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING user_id`,
        [u[0], u[1], u[2], passwordHash, u[3], u[4]]
      );
      userIds[u[0]] = res.rows[0].user_id;
    }

    // -------------------------------------------------------------------------
    // 4. HIERARCHICAL E-WASTE CATEGORIES (3-Level Taxonomy for Recursive CTE & SELF JOIN)
    // -------------------------------------------------------------------------
    const rootCats = [
      ['CAT-IT-ROOT', 'IT & Telecommunications Equipment', null, 'MEDIUM', 5, 82.00, 'Root EU/CPCB Grade I IT and telecom assets'],
      ['CAT-CE-ROOT', 'Consumer Displays & Media Equipment', null, 'HIGH', 6, 74.00, 'Root Grade II screens, monitors, and consumer electronics'],
      ['CAT-PW-ROOT', 'Power Storage & Energy Conditioning', null, 'CRITICAL', 4, 68.00, 'Root Grade III battery backups, inverters, and power units'],
    ];
    const catIds = {};
    for (const rc of rootCats) {
      const res = await client.query(
        `INSERT INTO e_waste_categories
          (category_code, name, parent_category_id, hazard_level, expected_lifespan_years, base_recyclability_pct, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING category_id`,
        rc
      );
      catIds[rc[0]] = res.rows[0].category_id;
    }

    const midCats = [
      ['CAT-COMP-MID', 'Personal & Enterprise Computing', catIds['CAT-IT-ROOT'], 'MEDIUM', 5, 85.00, 'Portable and stationary computing systems'],
      ['CAT-MOB-MID', 'Handheld & Mobile Telecom', catIds['CAT-IT-ROOT'], 'MEDIUM', 3, 79.00, 'Smartphones, tablets, and cellular routers'],
      ['CAT-DISP-MID', 'Visual Display Terminals', catIds['CAT-CE-ROOT'], 'HIGH', 6, 72.00, 'Flat-panel and cathode-ray display devices'],
    ];
    for (const mc of midCats) {
      const res = await client.query(
        `INSERT INTO e_waste_categories
          (category_code, name, parent_category_id, hazard_level, expected_lifespan_years, base_recyclability_pct, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING category_id`,
        mc
      );
      catIds[mc[0]] = res.rows[0].category_id;
    }

    const leafCats = [
      ['CAT-LAPTOP', 'Laptops & Ultrabooks', catIds['CAT-COMP-MID'], 'MEDIUM', 4, 86.50, 'Portable computers containing Li-Ion battery packs, SSD/RAM, and high-grade PCBs'],
      ['CAT-DESKTOP', 'Desktop Workstations', catIds['CAT-COMP-MID'], 'LOW', 6, 91.00, 'Modular tower/SFF desktops with steel chassis, ATX PSU, and motherboards'],
      ['CAT-SERVER', 'Enterprise Rack Servers', catIds['CAT-COMP-MID'], 'MEDIUM', 5, 93.50, 'High-gold-density enterprise server blades and storage arrays'],
      ['CAT-PHONE', 'Smartphones', catIds['CAT-MOB-MID'], 'MEDIUM', 3, 80.00, 'Compact mobile phones rich in cobalt, gold, palladium, and OLED assemblies'],
      ['CAT-TABLET', 'Tablets & E-Readers', catIds['CAT-MOB-MID'], 'MEDIUM', 4, 77.50, 'Pouch-battery slate computing devices'],
      ['CAT-MON-LED', 'LED / IPS Monitors', catIds['CAT-DISP-MID'], 'MEDIUM', 6, 78.00, 'Mercury-free flat-panel LCD/LED monitors'],
      ['CAT-MON-CRT', 'Legacy CRT & CCFL Displays', catIds['CAT-DISP-MID'], 'CRITICAL', 8, 52.00, 'Leaded funnel glass and mercury-vapor CCFL backlight displays'],
      ['CAT-UPS-BAT', 'UPS & Industrial Battery Systems', catIds['CAT-PW-ROOT'], 'CRITICAL', 4, 65.00, 'Lead-acid and high-capacity lithium backup units requiring hazardous controls'],
    ];
    for (const lc of leafCats) {
      const res = await client.query(
        `INSERT INTO e_waste_categories
          (category_code, name, parent_category_id, hazard_level, expected_lifespan_years, base_recyclability_pct, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING category_id`,
        lc
      );
      catIds[lc[0]] = res.rows[0].category_id;
    }

    // -------------------------------------------------------------------------
    // 5. COMPONENT CATALOG (12 Standardized Hardware Component Types)
    // -------------------------------------------------------------------------
    const compCatalogRows = [
      ['CMP-RAM', 'DDR4 / DDR5 Memory Module', 'MEMORY', false, 9, 0.025, 1650.00, 'ESD-safe antistatic tray storage; gold-finger inspection'],
      ['CMP-SSD', 'NVMe / SATA Solid State Drive', 'STORAGE', false, 9, 0.045, 2200.00, 'NIST 800-88 cryptographic sanitization mandatory prior to reuse'],
      ['CMP-LIBAT', 'Lithium-Ion Battery Pack', 'POWER_BATTERY', true, 3, 0.310, 450.00, 'Discharge below 30% SoC; store in vermiculite fireproof drum if swollen'],
      ['CMP-DISP', 'LCD / IPS Display Assembly', 'DISPLAY', false, 7, 0.580, 2800.00, 'Inspect ribbon cable and backlight uniformity; separate lid if cracked'],
      ['CMP-BKLT', 'CCFL / LED Backlight Sub-Unit', 'OPTICAL_CAMERA', true, 2, 0.140, 120.00, 'Contains delicate optical/mercury elements; route to TSDF if CCFL'],
      ['CMP-ALID', 'Anodized Aluminum Display Enclosure', 'CHASSIS_STRUCTURAL', false, 6, 0.360, 180.00, 'High-purity 6000-series aluminum suitable for direct smelting'],
      ['CMP-MOBO', 'Main Logic Motherboard PCB', 'CIRCUIT_BOARD', true, 4, 0.420, 950.00, 'High precious-metal PCB; depopulate CMOS coin cell and capacitors'],
      ['CMP-COOL', 'Copper Heatsink & Brushless Fan', 'THERMAL_COOLING', false, 7, 0.190, 320.00, 'Clean thermal paste; separate copper heatpipe if fan bearing failed'],
      ['CMP-PSU', 'Switched-Mode Power Supply Unit', 'POWER_BATTERY', false, 6, 1.150, 850.00, 'Discharge primary bulk capacitors before opening'],
      ['CMP-OLED', 'Smartphone OLED Digitizer Screen', 'DISPLAY', false, 8, 0.055, 3100.00, 'Test touch matrix and burn-in levels'],
      ['CMP-RAID', 'Enterprise PCIe RAID / NIC Card', 'CIRCUIT_BOARD', false, 8, 0.220, 3600.00, 'Verify PCIe lane handshake and bracket integrity'],
      ['CMP-PBAT', 'Sealed Lead-Acid Battery Cell', 'POWER_BATTERY', true, 1, 4.200, 380.00, 'Acid spill containment tray mandatory; route to authorized smelter/TSDF'],
    ];
    const compTypeIds = {};
    for (const c of compCatalogRows) {
      const res = await client.query(
        `INSERT INTO component_catalog
          (type_code, name, component_group, is_hazardous_default, reusability_score, typical_weight_kg, benchmark_value_inr, handling_instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING component_type_id`,
        c
      );
      compTypeIds[c[0]] = res.rows[0].component_type_id;
    }

    // -------------------------------------------------------------------------
    // 6. MATERIALS (10 Raw Recoverable & Hazardous Materials)
    // -------------------------------------------------------------------------
    const materialRows = [
      ['MAT-CU', 'Electrolytic Copper', 'BASE_METAL', false, 740.00, 3.800],
      ['MAT-AU', 'Secondary Gold Bullion Fraction', 'PRECIOUS_METAL', false, 6250000.00, 12500.000],
      ['MAT-AL', '6061 Secondary Aluminum', 'BASE_METAL', false, 215.00, 9.200],
      ['MAT-FE', 'Ferrous Structural Steel', 'FERROUS_METAL', false, 48.00, 1.650],
      ['MAT-ABS', 'ABS / Polycarbonate Polymer', 'POLYMER_PLASTIC', false, 92.00, 2.100],
      ['MAT-GLS', 'Aluminosilicate Display Glass', 'GLASS_CERAMIC', false, 28.00, 0.850],
      ['MAT-LICO', 'Lithium-Cobalt Black Mass', 'BATTERY_CHEMISTRY', true, 1480.00, 7.400],
      ['MAT-PB', 'Lead Solder & Leaded Funnel Glass', 'TOXIC_HEAVY_METAL', true, 160.00, 1.200],
      ['MAT-HG', 'Mercury Vapor Backlight Amalgam', 'TOXIC_HEAVY_METAL', true, 0.00, 0.400],
      ['MAT-ND', 'Neodymium Rare-Earth Magnet Alloy', 'PRECIOUS_METAL', false, 4200.00, 18.500],
    ];
    const matIds = {};
    for (const m of materialRows) {
      const res = await client.query(
        `INSERT INTO materials
          (material_code, name, material_class, is_hazardous, market_value_per_kg_inr, co2_saved_per_kg)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING material_id`,
        m
      );
      matIds[m[0]] = res.rows[0].material_id;
    }

    // -------------------------------------------------------------------------
    // 7. M:N JUNCTION #1: COMPONENT MATERIAL COMPOSITION
    // -------------------------------------------------------------------------
    const compositions = [
      ['CMP-RAM', 'MAT-CU', 32.0], ['CMP-RAM', 'MAT-AU', 0.18], ['CMP-RAM', 'MAT-ABS', 45.0],
      ['CMP-SSD', 'MAT-AL', 40.0], ['CMP-SSD', 'MAT-CU', 22.0], ['CMP-SSD', 'MAT-AU', 0.12],
      ['CMP-LIBAT', 'MAT-LICO', 62.0], ['CMP-LIBAT', 'MAT-CU', 14.0], ['CMP-LIBAT', 'MAT-AL', 12.0],
      ['CMP-DISP', 'MAT-GLS', 44.0], ['CMP-DISP', 'MAT-AL', 34.0], ['CMP-DISP', 'MAT-ABS', 16.0],
      ['CMP-BKLT', 'MAT-HG', 2.5], ['CMP-BKLT', 'MAT-GLS', 75.0],
      ['CMP-ALID', 'MAT-AL', 96.0],
      ['CMP-MOBO', 'MAT-CU', 36.0], ['CMP-MOBO', 'MAT-AU', 0.25], ['CMP-MOBO', 'MAT-PB', 3.2], ['CMP-MOBO', 'MAT-FE', 12.0],
      ['CMP-COOL', 'MAT-CU', 68.0], ['CMP-COOL', 'MAT-AL', 20.0], ['CMP-COOL', 'MAT-ND', 2.5],
      ['CMP-PSU', 'MAT-FE', 48.0], ['CMP-PSU', 'MAT-CU', 28.0], ['CMP-PSU', 'MAT-AL', 14.0],
      ['CMP-OLED', 'MAT-GLS', 58.0], ['CMP-OLED', 'MAT-CU', 12.0], ['CMP-OLED', 'MAT-AU', 0.08],
      ['CMP-RAID', 'MAT-CU', 34.0], ['CMP-RAID', 'MAT-AU', 0.22], ['CMP-RAID', 'MAT-FE', 18.0],
      ['CMP-PBAT', 'MAT-PB', 68.0], ['CMP-PBAT', 'MAT-ABS', 14.0],
    ];
    for (const [cCode, mCode, pct] of compositions) {
      await client.query(
        `INSERT INTO component_material_composition (component_type_id, material_id, typical_mass_pct)
         VALUES ($1,$2,$3)`,
        [compTypeIds[cCode], matIds[mCode], pct]
      );
    }

    // -------------------------------------------------------------------------
    // 8. RECYCLING & HAZARDOUS TSDF FACILITIES (6 Facilities)
    // -------------------------------------------------------------------------
    const facilityRows = [
      ['FAC-MET-01', 'Attero-Style Precious & Base Metal Refinery', 'PRECIOUS_METAL_REFINERY', 'CPCB/EW/HR/2024-0891', '2028-12-31', 'Roorkee', 'Uttarakhand', 420.00, false, 'ops@preciousrefinery-demo.in', '+91-9812001101'],
      ['FAC-BAT-02', 'Lohum Hydrometallurgy Battery Plant', 'BATTERY_HYDROMETALLURGY', 'UPPCB/BAT/2025-4412', '2029-06-30', 'Greater Noida', 'Uttar Pradesh', 310.00, true, 'intake@hydromet-demo.in', '+91-9812001102'],
      ['FAC-HAZ-03', 'Haryana Enviro TSDF Hazardous Containment', 'AUTHORIZED_TSDF_HAZARDOUS', 'HSPCB/TSDF/2024-0077', '2028-09-30', 'Pali-Faridabad', 'Haryana', 600.00, true, 'manifests@haryanatsdf-demo.in', '+91-9812001103'],
      ['FAC-POL-04', 'GreenPoly Circular Elastomers & Plastics', 'POLYMER_RECYCLER', 'DPCC/PLAST/2025-1190', '2028-03-31', 'Bawana', 'Delhi', 250.00, false, 'plant@greenpoly-demo.in', '+91-9812001104'],
      ['FAC-INT-05', 'E-Parisaraa Integrated E-Waste Smelter', 'INTEGRATED_EWASTE_PLANT', 'KSPCB/INT/2024-3305', '2029-01-31', 'Dobbaspet', 'Karnataka', 550.00, true, 'compliance@integratedsmelt-demo.in', '+91-9812001105'],
      ['FAC-SML-06', 'Deccan Ferrous & Aluminum Foundry', 'METAL_SMELTER', 'MPCB/MET/2025-6021', '2028-11-30', 'Chakan', 'Maharashtra', 480.00, false, 'dispatch@deccanfoundry-demo.in', '+91-9812001106'],
    ];
    const facIds = {};
    for (const f of facilityRows) {
      const res = await client.query(
        `INSERT INTO recycling_facilities
          (facility_code, name, facility_type, certification_number, license_valid_until, city, state,
           processing_capacity_tons_month, authorized_for_hazardous, contact_email, contact_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING facility_id`,
        f
      );
      facIds[f[0]] = res.rows[0].facility_id;
    }

    // -------------------------------------------------------------------------
    // 9. M:N JUNCTION #2: FACILITY ACCEPTED MATERIALS
    // -------------------------------------------------------------------------
    const facMaterials = [
      ['FAC-MET-01', 'MAT-CU', 98.5], ['FAC-MET-01', 'MAT-AU', 99.2], ['FAC-MET-01', 'MAT-ND', 91.0], ['FAC-MET-01', 'MAT-AL', 96.0],
      ['FAC-BAT-02', 'MAT-LICO', 95.8], ['FAC-BAT-02', 'MAT-CU', 94.0], ['FAC-BAT-02', 'MAT-AL', 93.0],
      ['FAC-HAZ-03', 'MAT-PB', 89.0], ['FAC-HAZ-03', 'MAT-HG', 99.5], ['FAC-HAZ-03', 'MAT-LICO', 88.0],
      ['FAC-POL-04', 'MAT-ABS', 92.5], ['FAC-POL-04', 'MAT-GLS', 87.0],
      ['FAC-INT-05', 'MAT-CU', 97.0], ['FAC-INT-05', 'MAT-AU', 98.4], ['FAC-INT-05', 'MAT-FE', 96.5], ['FAC-INT-05', 'MAT-AL', 95.5], ['FAC-INT-05', 'MAT-PB', 91.0],
      ['FAC-SML-06', 'MAT-FE', 97.8], ['FAC-SML-06', 'MAT-AL', 96.8], ['FAC-SML-06', 'MAT-CU', 93.5],
    ];
    for (const [fCode, mCode, eff] of facMaterials) {
      await client.query(
        `INSERT INTO facility_accepted_materials (facility_id, material_id, recovery_efficiency_pct)
         VALUES ($1,$2,$3)`,
        [facIds[fCode], matIds[mCode], eff]
      );
    }

    // -------------------------------------------------------------------------
    // 10. COLLECTION BATCHES (18 Batches across Jan 2026 - Nov 2026)
    // -------------------------------------------------------------------------
    const batchDefs = [
      ['COL-2026-0001', 'CTR-GGN-01', 'ORG-CORP-01', 'CORPORATE_BULK', 'EMP-002', '2026-01-14', 42.5, 'INFY-Q1-DECOMM-01', 'Annual corporate laptop refresh pickup'],
      ['COL-2026-0002', 'CTR-SOH-02', 'ORG-EDU-03', 'CAMPUS_COLLECTION', 'EMP-002', '2026-02-09', 38.0, 'KRMU-LAB-2026', 'Computer lab retirement drive'],
      ['COL-2026-0003', 'CTR-DEL-03', 'ORG-RET-05', 'RETAIL_TAKEBACK', 'EMP-007', '2026-02-24', 18.4, 'CROMA-TB-02', 'Consumer smartphone & tablet trade-in bin'],
      ['COL-2026-0004', 'CTR-GGN-01', 'ORG-GOV-04', 'MUNICIPAL_DRIVE', 'EMP-002', '2026-03-15', 64.0, 'GMDA-WARD-12', 'Municipal hazardous UPS & CRT collection camp'],
      ['COL-2026-0005', 'CTR-BLR-04', 'ORG-CORP-02', 'CORPORATE_BULK', 'EMP-002', '2026-04-06', 55.2, 'TATA-BLR-04', 'Enterprise blade servers & workstations'],
      ['COL-2026-0006', 'CTR-SOH-02', 'ORG-RES-06', 'MUNICIPAL_DRIVE', 'EMP-002', '2026-04-22', 24.8, 'EARTH-DAY-2026', 'Earth Day residential township e-waste camp'],
      ['COL-2026-0007', 'CTR-DEL-03', null, 'INDIVIDUAL_DROP_OFF', 'EMP-007', '2026-05-11', 12.6, 'WALKIN-MAY-01', 'Walk-in citizen drop-offs at Okhla depot'],
      ['COL-2026-0008', 'CTR-GGN-01', 'ORG-CORP-01', 'CORPORATE_BULK', 'EMP-002', '2026-06-05', 49.0, 'INFY-ENV-DAY', 'World Environment Day IT asset handover'],
      ['COL-2026-0009', 'CTR-BLR-04', 'ORG-CORP-02', 'CORPORATE_BULK', 'EMP-002', '2026-06-21', 36.5, 'TATA-Q2-LAP', 'Developer laptop & monitor batch'],
      ['COL-2026-0010', 'CTR-SOH-02', 'ORG-EDU-03', 'CAMPUS_COLLECTION', 'EMP-002', '2026-07-14', 44.2, 'KRMU-HOSTEL-07', 'Campus UPS & monitor decommissioning'],
      ['COL-2026-0011', 'CTR-DEL-03', 'ORG-RET-05', 'RETAIL_TAKEBACK', 'EMP-007', '2026-08-08', 21.0, 'CROMA-AUG-TB', 'Independence sale exchange e-waste batch'],
      ['COL-2026-0012', 'CTR-GGN-01', 'ORG-GOV-04', 'MUNICIPAL_DRIVE', 'EMP-002', '2026-08-26', 58.5, 'GMDA-MONSOON-08', 'Civic office desktop & display clearance'],
      ['COL-2026-0013', 'CTR-SOH-02', 'ORG-RES-06', 'INDIVIDUAL_DROP_OFF', 'EMP-002', '2026-09-12', 19.3, 'SOHNA-SEP-12', 'Community weekend drop-off'],
      ['COL-2026-0014', 'CTR-BLR-04', 'ORG-CORP-02', 'CORPORATE_BULK', 'EMP-002', '2026-09-28', 62.0, 'TATA-DC-SEP', 'Data center server & UPS retirement'],
      ['COL-2026-0015', 'CTR-GGN-01', 'ORG-CORP-01', 'CORPORATE_BULK', 'EMP-002', '2026-10-14', 47.8, 'INFY-EWASTE-DAY', 'International E-Waste Day bulk corporate drive'],
      ['COL-2026-0016', 'CTR-DEL-03', 'ORG-RET-05', 'RETAIL_TAKEBACK', 'EMP-007', '2026-10-29', 26.4, 'CROMA-DIWALI-26', 'Festive upgrade exchange electronics'],
      ['COL-2026-0017', 'CTR-SOH-02', 'ORG-EDU-03', 'CAMPUS_COLLECTION', 'EMP-002', '2026-11-10', 33.1, 'KRMU-NOV-26', 'Autumn semester IT hardware intake'],
      ['COL-2026-0018', 'CTR-GGN-01', 'ORG-GOV-04', 'MUNICIPAL_DRIVE', 'EMP-002', '2026-11-21', 29.5, 'GMDA-NOV-26', 'Recent November municipal intake batch'],
    ];

    const batchMap = {};
    for (const b of batchDefs) {
      const res = await client.query(
        `INSERT INTO collection_batches
          (batch_number, center_id, source_organization_id, source_type, collected_by_user_id,
           collection_date, declared_weight_kg, donor_reference, pickup_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING collection_id, center_id, collection_date`,
        [
          b[0],
          centerIds[b[1]],
          b[2] ? orgIds[b[2]] : null,
          b[3],
          userIds[b[4]],
          b[5],
          b[6],
          b[7],
          b[8],
        ]
      );
      batchMap[b[0]] = res.rows[0];
    }

    // Helper to register a device cleanly at REGISTERED with exact historical timestamp
    async function registerSeedDevice({
      seq,
      batchCode,
      catCode,
      brand,
      model,
      serial,
      year,
      weight,
      estVal,
      grade,
      hazardous,
      notes,
      regIso,
    }) {
      const tracking = `RLP-2026-${String(seq).padStart(5, '0')}`;
      const batch = batchMap[batchCode];
      await setTransitionContext(client, {
        userId: userIds['EMP-002'],
        referenceEntity: 'REGISTRATION',
        referenceId: batch.collection_id,
        notes: `Registered under intake batch ${batchCode}`,
        timestamp: regIso,
      });
      const res = await client.query(
        `INSERT INTO devices
          (tracking_number, collection_id, category_id, current_center_id, brand, model_name,
           serial_number, manufacture_year, weight_kg, estimated_value_inr, current_status,
           condition_grade, contains_hazardous_materials, source_notes, registered_by, registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REGISTERED',$11,$12,$13,$14,$15)
         RETURNING device_id, tracking_number`,
        [
          tracking,
          batch.collection_id,
          catIds[catCode],
          batch.center_id,
          brand,
          model,
          serial,
          year,
          weight,
          estVal,
          grade,
          hazardous,
          notes,
          userIds['EMP-002'],
          regIso,
        ]
      );
      return res.rows[0].device_id;
    }

    let inspSeq = 1;
    let repSeq = 1;
    let dismSeq = 1;
    let compSeq = 1;
    let matLotSeq = 1;
    let dispSeq = 1;

    async function createInspection(deviceId, inspectorEmp, opts) {
      const code = `INSP-2026-${String(inspSeq++).padStart(4, '0')}`;
      const res = await client.query(
        `INSERT INTO inspections
          (inspection_code, device_id, inspector_id, physical_condition, functional_status,
           power_on_passed, battery_health_pct, hazard_detected, hazard_notes,
           overall_grade, recommended_pathway, inspector_summary, inspected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING inspection_id`,
        [
          code,
          deviceId,
          userIds[inspectorEmp],
          opts.physical || 'MINOR_WEAR',
          opts.functional || 'PARTIAL_BOOT',
          opts.powerOn ?? true,
          opts.batteryHealth ?? null,
          opts.hazard ?? false,
          opts.hazardNotes || null,
          opts.grade || 'GRADE_B',
          opts.pathway,
          opts.summary,
          opts.inspectedAt,
        ]
      );
      const inspectionId = res.rows[0].inspection_id;
      const checks = opts.checks || [
        ['Power Rail & Logic Board', opts.powerOn ? 'PASS' : 'FAIL', opts.powerOn ? '19.5V nominal' : '0V short', 'Bench multimeter diagnostic'],
        ['Chassis & External Ports', opts.hazard ? 'HAZARDOUS' : 'PASS', 'Visual check', 'Enclosure integrity check'],
        ['Storage / Memory Interface', opts.grade === 'NON_FUNCTIONAL' ? 'DEGRADED' : 'PASS', 'SMART bus scan', 'Automated bus check'],
      ];
      for (const ch of checks) {
        await client.query(
          `INSERT INTO inspection_check_results
            (inspection_id, subsystem_name, check_status, measured_metric, remarks)
           VALUES ($1,$2,$3,$4,$5)`,
          [inspectionId, ch[0], ch[1], ch[2], ch[3]]
        );
      }
      await client.query(
        'UPDATE devices SET condition_grade = $1, contains_hazardous_materials = (contains_hazardous_materials OR $2) WHERE device_id = $3',
        [opts.grade || 'GRADE_B', Boolean(opts.hazard), deviceId]
      );
      return inspectionId;
    }

    // =========================================================================
    // FLAGSHIP ARCHETYPE DEVICES (RLP-2026-00001 to RLP-2026-00005)
    // =========================================================================

    // First dismantle RLP-2026-00002 so its harvested DDR4 RAM (CMP-2026-00001)
    // can be installed into RLP-2026-00001's repair record!
    // Wait: let's register 00001 first (so device_id 1 = RLP-2026-00001, device_id 2 = RLP-2026-00002)!
    const dev1 = await registerSeedDevice({
      seq: 1,
      batchCode: 'COL-2026-0001',
      catCode: 'CAT-LAPTOP',
      brand: 'Dell',
      model: 'Latitude 7420 Ultrabook',
      serial: 'DL7420-INFY-9901',
      year: 2022,
      weight: 1.38,
      estVal: 18500,
      grade: 'GRADE_B',
      hazardous: true,
      notes: 'Corporate refresh laptop; faulty DIMM slot module, healthy screen & NVMe',
      regIso: '2026-01-14T09:30:00Z',
    });

    const dev2 = await registerSeedDevice({
      seq: 2,
      batchCode: 'COL-2026-0001',
      catCode: 'CAT-LAPTOP',
      brand: 'HP',
      model: 'EliteBook 840 G6',
      serial: 'HP840G6-INFY-4412',
      year: 2020,
      weight: 1.48,
      estVal: 8200,
      grade: 'NON_FUNCTIONAL',
      hazardous: true,
      notes: 'VRM motherboard burn-out & swollen pouch Li-Ion battery; harvestable RAM/SSD/display',
      regIso: '2026-01-14T09:45:00Z',
    });

    // Progress Device 2 (HP EliteBook) through Dismantling + Sub-Component Tree + Material Recovery + Hazardous Battery Disposal!
    await transitionDevice(client, dev2, 'COLLECTED', {
      userId: userIds['EMP-002'],
      referenceEntity: 'COLLECTION',
      notes: 'Verified at Gurugram Central Hub',
      timestamp: '2026-01-14T13:00:00Z',
    });
    await transitionDevice(client, dev2, 'UNDER_INSPECTION', {
      userId: userIds['EMP-003'],
      referenceEntity: 'INSPECTION_QUEUE',
      notes: 'Assigned to Inspector Rohan Kulkarni',
      timestamp: '2026-01-15T10:00:00Z',
    });
    const insp2 = await createInspection(dev2, 'EMP-003', {
      physical: 'SWOLLEN_OR_LEAKING',
      functional: 'NO_POWER',
      powerOn: false,
      batteryHealth: 12.0,
      hazard: true,
      hazardNotes: 'Swollen 50Wh Li-Ion pouch cell; VRM MOSFET shorted on mainboard',
      grade: 'NON_FUNCTIONAL',
      pathway: 'DISMANTLE',
      summary: 'Unrepairable board short; high-value DDR4 RAM, 512GB NVMe SSD, and display assembly recoverable via precision dismantling.',
      inspectedAt: '2026-01-15T14:20:00Z',
      checks: [
        ['Motherboard Power Rail', 'FAIL', '0.4 Ohm short to GND', 'CPU phase MOSFET burned'],
        ['DDR4 SODIMM Memory', 'PASS', '16GB DDR4-3200 MemTest OK', 'Fully reusable in laptop refurbishment'],
        ['NVMe M.2 Storage', 'PASS', '96% life remaining', 'Sanitized via NIST 800-88 purge'],
        ['Li-Ion Battery Pack', 'HAZARDOUS', '12% SoC, cell swelling 6mm', 'Isolate in vermiculite drum immediately'],
      ],
    });
    await transitionDevice(client, dev2, 'UNDER_DISMANTLING', {
      userId: userIds['EMP-003'],
      referenceEntity: 'INSPECTION',
      referenceId: insp2,
      notes: 'Routed to precision dismantling workbench after inspection',
      timestamp: '2026-01-15T15:00:00Z',
    });

    const dism2Res = await client.query(
      `INSERT INTO dismantling_records
        (dismantling_code, device_id, operator_id, center_id, dismantling_method,
         safety_protocol_verified, residual_scrap_kg, dismantled_at, notes)
       VALUES ($1,$2,$3,$4,'MANUAL_PRECISION',TRUE,0.085,'2026-01-16T11:30:00Z',$5)
       RETURNING dismantling_id`,
      [
        `DISM-2026-${String(dismSeq++).padStart(4, '0')}`,
        dev2,
        userIds['EMP-005'],
        centerIds['CTR-GGN-01'],
        'Full ESD-safe teardown; Li-Ion battery isolated first; display assembly further split into sub-units.',
      ]
    );
    const dism2Id = dism2Res.rows[0].dismantling_id;

    // Harvested components from Device 2 (including recursive sub-components!)
    const cmp1Uid = `CMP-2026-${String(compSeq++).padStart(5, '0')}`; // DDR4 RAM -> Reused in Device 1!
    const cmp1Res = await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, serial_or_part_no,
         condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'SKH-16G-3200AA','WORKING',0.024,1800,'IN_INVENTORY','REPAIR','2026-01-16T11:40:00Z','Reserved for Dell Latitude 7420 refurbishment')
       RETURNING recovered_component_id`,
      [cmp1Uid, dism2Id, dev2, compTypeIds['CMP-RAM']]
    );
    const harvestedRamId = cmp1Res.rows[0].recovered_component_id;

    await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, serial_or_part_no,
         condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'WD-SN730-512G','WORKING',0.042,2450,'SOLD_FOR_REUSE','RESALE','2026-01-16T11:45:00Z','Wiped & sold to certified secondary IT refurbisher')`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-SSD']]
    );

    const bat2Res = await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, serial_or_part_no,
         condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'HP-SS03XL-SW','HAZARDOUS_INTACT',0.295,0,'HAZARDOUS_DISPOSED','HAZARDOUS_DISPOSAL',$5,'2026-01-16T11:50:00Z','Swollen Li-Ion pack encapsulated & sent to Haryana Enviro TSDF')
       RETURNING recovered_component_id`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-LIBAT'], facIds['FAC-HAZ-03']]
    );

    // Parent Display Assembly extracted from Device 2, then split into 2 Child Sub-Components (demonstrates multi-level Recursive CTE!)
    const dispParentRes = await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, serial_or_part_no,
         condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'AUO-140HAN04-ASSY','DAMAGED_RECYCLABLE',0.510,300,'RECYCLED','RECYCLING','2026-01-16T12:00:00Z','Cracked polarizer; sub-disassembled into backlight optical unit and aluminum lid')
       RETURNING recovered_component_id`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-DISP']]
    );
    const dispParentId = dispParentRes.rows[0].recovered_component_id;

    // Child 1 of Display Assembly: Backlight unit
    await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, parent_recovered_component_id,
         serial_or_part_no, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,$5,'AUO-BKLT-SUB1','DAMAGED_RECYCLABLE',0.135,90,'RECYCLED','RECYCLING',$6,'2026-01-16T12:15:00Z','Optical glass fraction sent to GreenPoly glass/polymer line')`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-BKLT'], dispParentId, facIds['FAC-POL-04']]
    );

    // Child 2 of Display Assembly: Anodized Aluminum Lid
    const aluChildRes = await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, parent_recovered_component_id,
         serial_or_part_no, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,$5,'HP-840G6-ALULID','DAMAGED_RECYCLABLE',0.340,175,'RECYCLED','RECYCLING',$6,'2026-01-16T12:20:00Z','Clean 6061 aluminum top cover smelted')
       RETURNING recovered_component_id`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-ALID'], dispParentId, facIds['FAC-MET-01']]
    );

    // Motherboard & Copper Heatsink from Device 2
    const mobo2Res = await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, serial_or_part_no,
         condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'HP-DAX8JMB16E0','DAMAGED_RECYCLABLE',0.380,920,'RECYCLED','RECYCLING',$5,'2026-01-16T12:25:00Z','Precious-metal PCB sent to refinery')
       RETURNING recovered_component_id`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism2Id, dev2, compTypeIds['CMP-MOBO'], facIds['FAC-MET-01']]
    );

    await transitionDevice(client, dev2, 'DISMANTLED', {
      userId: userIds['EMP-005'],
      referenceEntity: 'DISMANTLING',
      referenceId: dism2Id,
      notes: 'All 7 primary & sub-assembly components cataloged',
      timestamp: '2026-01-16T13:00:00Z',
    });

    // Hazardous disposal for swollen battery of Device 2 + Material recovery for motherboard/aluminum -> Device 2 becomes RECYCLED
    await client.query(
      `INSERT INTO disposal_records
        (manifest_number, device_id, recovered_component_id, facility_id, authorized_by,
         hazard_classification, treatment_method, hazard_weight_kg, compliance_certificate_no,
         evidence_document_ref, disposal_cost_inr, disposed_at, notes)
       VALUES ($1,$2,$3,$4,$5,'Class 9 Swollen Lithium-Ion Battery Cell','CHEMICAL_NEUTRALIZATION',0.295,$6,'s3://reloop-manifests/2026/HAZ-0001.pdf',420.00,'2026-01-18T10:30:00Z','Neutralized and stabilized under HSPCB manifest')`,
      [
        `HAZ-MAN-2026-${String(dispSeq++).padStart(4, '0')}`,
        dev2,
        bat2Res.rows[0].recovered_component_id,
        facIds['FAC-HAZ-03'],
        userIds['EMP-005'],
        'HSPCB-CERT-2026-8801',
      ]
    );

    await transitionDevice(client, dev2, 'UNDER_RECYCLING', {
      userId: userIds['EMP-005'],
      referenceEntity: 'MATERIAL_RECOVERY',
      notes: 'PCB and aluminum hull dispatched to precious/base metal refinery',
      timestamp: '2026-01-18T14:00:00Z',
    });

    await client.query(
      `INSERT INTO material_recovery_records
        (lot_number, source_device_id, recovered_component_id, material_id, facility_id, recorded_by,
         recovered_weight_kg, purity_grade_pct, recycling_status, recovery_date, recycled_confirmed_date, certificate_ref)
       VALUES
        ($1,$2,$3,$4,$5,$6,0.3280,98.4,'PROCESSED_VERIFIED','2026-01-19','2026-01-23','REF-CERT-2026-0101'),
        ($7,$2,$8,$9,$5,$6,0.1420,99.1,'PROCESSED_VERIFIED','2026-01-19','2026-01-23','REF-CERT-2026-0102'),
        ($10,$2,$8,$11,$5,$6,0.0009,99.9,'PROCESSED_VERIFIED','2026-01-19','2026-01-24','REF-CERT-2026-0103')`,
      [
        `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
        dev2,
        aluChildRes.rows[0].recovered_component_id,
        matIds['MAT-AL'],
        facIds['FAC-MET-01'],
        userIds['EMP-005'],
        `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
        mobo2Res.rows[0].recovered_component_id,
        matIds['MAT-CU'],
        `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
        matIds['MAT-AU'],
      ]
    );

    await transitionDevice(client, dev2, 'RECYCLED', {
      userId: userIds['EMP-005'],
      referenceEntity: 'RECYCLING',
      notes: 'Refinery recovery certificates verified for Al, Cu, and Au fractions',
      timestamp: '2026-01-24T16:00:00Z',
    });

    // Now progress Device 1 (Dell Latitude 7420) through Inspection -> Repair (installing harvestedRamId from Device 2!) -> Refurbished -> Ready for Reuse!
    await transitionDevice(client, dev1, 'COLLECTED', {
      userId: userIds['EMP-002'],
      referenceEntity: 'COLLECTION',
      notes: 'Checked into Gurugram Central Circular Hub',
      timestamp: '2026-01-14T13:10:00Z',
    });
    await transitionDevice(client, dev1, 'UNDER_INSPECTION', {
      userId: userIds['EMP-003'],
      referenceEntity: 'INSPECTION_QUEUE',
      notes: 'Diagnostic bench check started',
      timestamp: '2026-01-15T11:00:00Z',
    });
    const insp1 = await createInspection(dev1, 'EMP-003', {
      physical: 'MINOR_WEAR',
      functional: 'HARDWARE_FAULT',
      powerOn: true,
      batteryHealth: 86.5,
      hazard: false,
      grade: 'GRADE_B',
      pathway: 'REPAIR',
      summary: 'POST memory error on primary DDR4 SODIMM; battery 86.5% healthy and IPS panel pristine. Ideal refurbishment candidate.',
      inspectedAt: '2026-01-15T16:00:00Z',
    });
    await transitionDevice(client, dev1, 'REPAIRABLE', {
      userId: userIds['EMP-003'],
      referenceEntity: 'INSPECTION',
      referenceId: insp1,
      notes: 'Classified REPAIRABLE following diagnostic inspection',
      timestamp: '2026-01-15T16:15:00Z',
    });
    await transitionDevice(client, dev1, 'UNDER_REPAIR', {
      userId: userIds['EMP-004'],
      referenceEntity: 'REPAIR',
      notes: 'Repair ticket opened by Sneha Iyer',
      timestamp: '2026-01-17T09:30:00Z',
    });
    const rep1Res = await client.query(
      `INSERT INTO repair_records
        (ticket_number, device_id, inspection_id, technician_id, issue_diagnosis, repair_actions,
         estimated_cost_inr, actual_cost_inr, repair_status, qa_verified, reuse_destination_org_id,
         reuse_channel, resale_value_inr, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,1500,650,'COMPLETED',TRUE,$7,'EDUCATIONAL_GRANT',19500,'2026-01-17T09:30:00Z','2026-01-18T17:00:00Z')
       RETURNING repair_id`,
      [
        `REP-2026-${String(repSeq++).padStart(4, '0')}`,
        dev1,
        insp1,
        userIds['EMP-004'],
        'Corrupted factory 8GB SODIMM module causing 2-amber-4-white blink code',
        `Installed circular harvested 16GB DDR4-3200 module (${cmp1Uid}) recovered from dismantled HP EliteBook RLP-2026-00002; updated BIOS and passed 4-hour burn-in QA.`,
        orgIds['ORG-NGO-07'],
      ]
    );
    const rep1Id = rep1Res.rows[0].repair_id;

    // Link harvested RAM from Device 2 directly to Device 1's repair record! (Cross-device Circular Traceability!)
    await client.query(
      `UPDATE recovered_components
          SET current_status = 'REUSED_IN_DEVICE',
              destination_type = 'REUSE',
              installed_in_repair_id = $1,
              destination_notes = 'Installed into refurbished Dell Latitude 7420 (RLP-2026-00001)'
        WHERE recovered_component_id = $2`,
      [rep1Id, harvestedRamId]
    );

    await transitionDevice(client, dev1, 'REFURBISHED', {
      userId: userIds['EMP-004'],
      referenceEntity: 'REPAIR',
      referenceId: rep1Id,
      notes: 'Refurbished using circular harvested DDR4 RAM; QA passed',
      timestamp: '2026-01-18T17:15:00Z',
    });
    await transitionDevice(client, dev1, 'READY_FOR_REUSE', {
      userId: userIds['EMP-004'],
      referenceEntity: 'REUSE_ALLOCATION',
      referenceId: rep1Id,
      notes: 'Certified READY_FOR_REUSE and allocated to VidyaSetu Digital Inclusion Foundation',
      timestamp: '2026-01-20T11:00:00Z',
    });

    // Archetype 3: RLP-2026-00003 (Apple iPhone 13 Smartphone -> Dismantled -> OLED reused, Li-Co recycled)
    const dev3 = await registerSeedDevice({
      seq: 3,
      batchCode: 'COL-2026-0003',
      catCode: 'CAT-PHONE',
      brand: 'Apple',
      model: 'iPhone 13 128GB',
      serial: 'APL-IP13-CR9012',
      year: 2022,
      weight: 0.174,
      estVal: 12000,
      grade: 'NON_FUNCTIONAL',
      hazardous: true,
      notes: 'Baseband IC dead from water ingress; intact Super Retina XDR OLED screen',
      regIso: '2026-02-24T10:15:00Z',
    });
    await transitionDevice(client, dev3, 'COLLECTED', { userId: userIds['EMP-007'], timestamp: '2026-02-24T14:00:00Z', notes: 'Collected at Okhla Depot' });
    await transitionDevice(client, dev3, 'UNDER_INSPECTION', { userId: userIds['EMP-006'], timestamp: '2026-02-25T09:30:00Z', notes: 'Smartphone micro-diagnostics' });
    const insp3 = await createInspection(dev3, 'EMP-006', {
      physical: 'MINOR_WEAR', functional: 'HARDWARE_FAULT', powerOn: false, batteryHealth: 74.0,
      hazard: true, hazardNotes: 'Lithium pouch cell requires hydrometallurgical extraction',
      grade: 'NON_FUNCTIONAL', pathway: 'DISMANTLE',
      summary: 'Logic board corroded; genuine OLED assembly intact for reuse.',
      inspectedAt: '2026-02-25T12:00:00Z',
    });
    await transitionDevice(client, dev3, 'UNDER_DISMANTLING', { userId: userIds['EMP-006'], referenceEntity: 'INSPECTION', referenceId: insp3, timestamp: '2026-02-25T13:00:00Z' });
    const dism3Res = await client.query(
      `INSERT INTO dismantling_records (dismantling_code, device_id, operator_id, center_id, dismantling_method, residual_scrap_kg, dismantled_at, notes)
       VALUES ($1,$2,$3,$4,'MANUAL_PRECISION',0.018,'2026-02-26T11:00:00Z','Heated suction screen separation & battery pull-tab extraction') RETURNING dismantling_id`,
      [`DISM-2026-${String(dismSeq++).padStart(4, '0')}`, dev3, userIds['EMP-005'], centerIds['CTR-DEL-03']]
    );
    const dism3Id = dism3Res.rows[0].dismantling_id;
    await client.query(
      `INSERT INTO recovered_components (component_uid, dismantling_id, source_device_id, component_type_id, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'WORKING',0.052,3400,'SOLD_FOR_REUSE','RESALE','2026-02-26T11:20:00Z','OEM OLED display sold to authorized repair network')`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism3Id, dev3, compTypeIds['CMP-OLED']]
    );
    const bat3Res = await client.query(
      `INSERT INTO recovered_components (component_uid, dismantling_id, source_device_id, component_type_id, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id, recovered_at, destination_notes)
       VALUES ($1,$2,$3,$4,'DAMAGED_RECYCLABLE',0.048,180,'RECYCLED','RECYCLING',$5,'2026-02-26T11:25:00Z','Sent to Lohum Battery Hydrometallurgy') RETURNING recovered_component_id`,
      [`CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism3Id, dev3, compTypeIds['CMP-LIBAT'], facIds['FAC-BAT-02']]
    );
    await transitionDevice(client, dev3, 'DISMANTLED', { userId: userIds['EMP-005'], referenceEntity: 'DISMANTLING', referenceId: dism3Id, timestamp: '2026-02-26T12:00:00Z' });
    await client.query(
      `INSERT INTO material_recovery_records (lot_number, source_device_id, recovered_component_id, material_id, facility_id, recorded_by, recovered_weight_kg, purity_grade_pct, recycling_status, recovery_date, recycled_confirmed_date, certificate_ref)
       VALUES ($1,$2,$3,$4,$5,$6,0.0390,96.5,'PROCESSED_VERIFIED','2026-02-28','2026-03-04','LOHUM-2026-0311')`,
      [`MAT-2026-${String(matLotSeq++).padStart(4, '0')}`, dev3, bat3Res.rows[0].recovered_component_id, matIds['MAT-LICO'], facIds['FAC-BAT-02'], userIds['EMP-005']]
    );
    await transitionDevice(client, dev3, 'RECYCLED', { userId: userIds['EMP-005'], referenceEntity: 'RECYCLING', timestamp: '2026-03-04T15:00:00Z', notes: 'Cobalt-lithium black mass and gold board fraction recycled' });

    // Archetype 4: RLP-2026-00004 (APC Smart-UPS 1500VA -> Severe Lead-Acid Leak -> Direct Hazardous Disposal)
    const dev4 = await registerSeedDevice({
      seq: 4,
      batchCode: 'COL-2026-0004',
      catCode: 'CAT-UPS-BAT',
      brand: 'APC Schneider',
      model: 'Smart-UPS 1500VA Rack',
      serial: 'APC-SUA1500-GMDA1',
      year: 2018,
      weight: 24.20,
      estVal: 1200,
      grade: 'HAZARDOUS',
      hazardous: true,
      notes: 'Sulfated & leaking sealed lead-acid battery bank collected during civic drive',
      regIso: '2026-03-15T10:00:00Z',
    });
    await transitionDevice(client, dev4, 'COLLECTED', { userId: userIds['EMP-002'], timestamp: '2026-03-15T12:00:00Z' });
    await transitionDevice(client, dev4, 'UNDER_INSPECTION', { userId: userIds['EMP-003'], timestamp: '2026-03-16T09:00:00Z' });
    const insp4 = await createInspection(dev4, 'EMP-003', {
      physical: 'SWOLLEN_OR_LEAKING', functional: 'UNSAFE_TO_ENERGIZE', powerOn: false, batteryHealth: 0,
      hazard: true, hazardNotes: 'Electrolyte sulfate crystallization on terminal casing; immediate TSDF containment required',
      grade: 'HAZARDOUS', pathway: 'HAZARDOUS_DISPOSAL',
      summary: 'Acute chemical hazard; unsafe for manual bench dismantling. Routed directly to TSDF hazardous treatment.',
      inspectedAt: '2026-03-16T10:30:00Z',
    });
    const disp4Res = await client.query(
      `INSERT INTO disposal_records
        (manifest_number, device_id, facility_id, authorized_by, hazard_classification,
         treatment_method, hazard_weight_kg, compliance_certificate_no, evidence_document_ref,
         disposal_cost_inr, disposed_at, notes)
       VALUES ($1,$2,$3,$4,'Corrosive Lead-Acid Electrolyte & Sulfated Plates','CHEMICAL_NEUTRALIZATION',24.20,$5,'s3://reloop-manifests/2026/HAZ-0002.pdf',2850.00,'2026-03-17T14:00:00Z','Full hazardous manifest Form-10 filed')
       RETURNING disposal_id`,
      [`HAZ-MAN-2026-${String(dispSeq++).padStart(4, '0')}`, dev4, facIds['FAC-HAZ-03'], userIds['EMP-005'], 'HSPCB-CERT-2026-8802']
    );
    await transitionDevice(client, dev4, 'DISPOSED', {
      userId: userIds['EMP-005'],
      referenceEntity: 'DISPOSAL',
      referenceId: disp4Res.rows[0].disposal_id,
      notes: 'Disposed at Haryana Enviro TSDF under Form-10 manifest',
      timestamp: '2026-03-17T15:00:00Z',
    });

    // Archetype 5: RLP-2026-00005 (Lenovo ThinkCentre Desktop -> Transferred Centers -> Failed Repair -> Dismantled -> Recycled)
    const dev5 = await registerSeedDevice({
      seq: 5,
      batchCode: 'COL-2026-0002',
      catCode: 'CAT-DESKTOP',
      brand: 'Lenovo',
      model: 'ThinkCentre M920t Tower',
      serial: 'LNV-M920-KRMU05',
      year: 2019,
      weight: 6.85,
      estVal: 9500,
      grade: 'GRADE_C',
      hazardous: false,
      notes: 'Intermittent boot freeze from university computer lab',
      regIso: '2026-02-09T11:00:00Z',
    });
    await transitionDevice(client, dev5, 'COLLECTED', { userId: userIds['EMP-002'], timestamp: '2026-02-09T14:00:00Z' });
    // Record inter-center transfer from Sohna Hub to Gurugram Central Hub
    await client.query(
      `INSERT INTO device_transfers
        (transfer_code, device_id, from_center_id, to_center_id, initiated_by, received_by,
         transfer_status, vehicle_manifest, transferred_at, received_at, notes)
       VALUES ('TRF-2026-100001',$1,$2,$3,$4,$5,'COMPLETED','HR-55-EV-4021','2026-02-10T09:00:00Z','2026-02-10T11:30:00Z','Transferred from Sohna intake to Gurugram BGA repair bench')`,
      [dev5, centerIds['CTR-SOH-02'], centerIds['CTR-GGN-01'], userIds['EMP-002'], userIds['EMP-003']]
    );
    await client.query('UPDATE devices SET current_center_id = $1 WHERE device_id = $2', [centerIds['CTR-GGN-01'], dev5]);
    await transitionDevice(client, dev5, 'UNDER_INSPECTION', { userId: userIds['EMP-003'], timestamp: '2026-02-10T14:00:00Z' });
    const insp5 = await createInspection(dev5, 'EMP-003', {
      physical: 'MINOR_WEAR', functional: 'PARTIAL_BOOT', powerOn: true,
      grade: 'GRADE_C', pathway: 'REPAIR',
      summary: 'Suspected ATX PSU ripple instability; attempt bench repair.',
      inspectedAt: '2026-02-10T16:30:00Z',
    });
    await transitionDevice(client, dev5, 'REPAIRABLE', { userId: userIds['EMP-003'], referenceEntity: 'INSPECTION', referenceId: insp5, timestamp: '2026-02-10T17:00:00Z' });
    await transitionDevice(client, dev5, 'UNDER_REPAIR', { userId: userIds['EMP-004'], timestamp: '2026-02-11T10:00:00Z' });
    const rep5Res = await client.query(
      `INSERT INTO repair_records
        (ticket_number, device_id, inspection_id, technician_id, issue_diagnosis, repair_actions,
         estimated_cost_inr, actual_cost_inr, repair_status, qa_verified, started_at, completed_at)
       VALUES ($1,$2,$3,$4,'PCH BGA micro-fracture discovered after PSU swap','Tested known-good PSU; confirmed southbridge BGA pad delamination; escalated to dismantling',2200,350,'UNREPAIRABLE_ESCALATED',FALSE,'2026-02-11T10:00:00Z','2026-02-12T15:00:00Z')
       RETURNING repair_id`,
      [`REP-2026-${String(repSeq++).padStart(4, '0')}`, dev5, insp5, userIds['EMP-004']]
    );
    await transitionDevice(client, dev5, 'UNDER_DISMANTLING', {
      userId: userIds['EMP-004'],
      referenceEntity: 'REPAIR',
      referenceId: rep5Res.rows[0].repair_id,
      notes: 'Repair unfeasible due to PCH pad delamination; escalated to dismantling',
      timestamp: '2026-02-12T15:30:00Z',
    });
    const dism5Res = await client.query(
      `INSERT INTO dismantling_records (dismantling_code, device_id, operator_id, center_id, dismantling_method, residual_scrap_kg, dismantled_at, notes)
       VALUES ($1,$2,$3,$4,'SEMI_AUTOMATED',3.20,'2026-02-13T11:00:00Z','Harvested working DDR4 RAM, ATX PSU, and copper cooler; steel tower chassis sent to foundry') RETURNING dismantling_id`,
      [`DISM-2026-${String(dismSeq++).padStart(4, '0')}`, dev5, userIds['EMP-005'], centerIds['CTR-GGN-01']]
    );
    const dism5Id = dism5Res.rows[0].dismantling_id;
    await client.query(
      `INSERT INTO recovered_components
        (component_uid, dismantling_id, source_device_id, component_type_id, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, recovered_at, destination_notes)
       VALUES
        ($1,$2,$3,$4,'WORKING',0.025,1550,'IN_INVENTORY','REPAIR','2026-02-13T11:20:00Z','Healthy 16GB desktop DIMM stocked for repair bench'),
        ($5,$2,$3,$6,'WORKING',1.120,800,'IN_INVENTORY','REUSE','2026-02-13T11:25:00Z','Tested 80+ Platinum ATX PSU stocked'),
        ($7,$2,$3,$8,'DAMAGED_RECYCLABLE',0.210,340,'RECYCLED','RECYCLING','2026-02-13T11:30:00Z','Copper heatsink dispatched to smelter')`,
      [
        `CMP-2026-${String(compSeq++).padStart(5, '0')}`, dism5Id, dev5, compTypeIds['CMP-RAM'],
        `CMP-2026-${String(compSeq++).padStart(5, '0')}`, compTypeIds['CMP-PSU'],
        `CMP-2026-${String(compSeq++).padStart(5, '0')}`, compTypeIds['CMP-COOL'],
      ]
    );
    await transitionDevice(client, dev5, 'DISMANTLED', { userId: userIds['EMP-005'], referenceEntity: 'DISMANTLING', referenceId: dism5Id, timestamp: '2026-02-13T12:00:00Z' });
    await client.query(
      `INSERT INTO material_recovery_records
        (lot_number, source_device_id, material_id, facility_id, recorded_by, recovered_weight_kg, purity_grade_pct, recycling_status, recovery_date, recycled_confirmed_date, certificate_ref)
       VALUES
        ($1,$2,$3,$4,$5,4.1500,97.5,'PROCESSED_VERIFIED','2026-02-15','2026-02-19','DECCAN-FE-0215'),
        ($6,$2,$7,$8,$5,0.4800,98.2,'PROCESSED_VERIFIED','2026-02-15','2026-02-20','REF-CU-0215')`,
      [
        `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`, dev5, matIds['MAT-FE'], facIds['FAC-SML-06'], userIds['EMP-005'],
        `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`, matIds['MAT-CU'], facIds['FAC-MET-01'],
      ]
    );
    await transitionDevice(client, dev5, 'RECYCLED', { userId: userIds['EMP-005'], referenceEntity: 'RECYCLING', timestamp: '2026-02-20T16:00:00Z' });

    // =========================================================================
    // PROCEDURAL REALISTIC GENERATION OF 70 MORE DEVICES (RLP-2026-00006 .. 00075)
    // Covers every category, batch, month, and lifecycle stage!
    // =========================================================================
    const catalogModels = [
      { cat: 'CAT-LAPTOP', brand: 'Lenovo', model: 'ThinkPad T14 Gen 2', w: 1.46, val: 16500, haz: true },
      { cat: 'CAT-LAPTOP', brand: 'Dell', model: 'XPS 13 9310', w: 1.24, val: 21000, haz: true },
      { cat: 'CAT-LAPTOP', brand: 'HP', model: 'ProBook 440 G8', w: 1.38, val: 14200, haz: true },
      { cat: 'CAT-DESKTOP', brand: 'Dell', model: 'OptiPlex 7080 SFF', w: 5.30, val: 11800, haz: false },
      { cat: 'CAT-DESKTOP', brand: 'HP', model: 'EliteDesk 800 G5', w: 6.10, val: 10900, haz: false },
      { cat: 'CAT-SERVER', brand: 'Dell EMC', model: 'PowerEdge R640 1U', w: 16.80, val: 42000, haz: false },
      { cat: 'CAT-SERVER', brand: 'HPE', model: 'ProLiant DL380 Gen10', w: 19.40, val: 46500, haz: false },
      { cat: 'CAT-PHONE', brand: 'Samsung', model: 'Galaxy S22 5G', w: 0.168, val: 11500, haz: true },
      { cat: 'CAT-PHONE', brand: 'OnePlus', model: 'OnePlus 10 Pro', w: 0.201, val: 9800, haz: true },
      { cat: 'CAT-TABLET', brand: 'Apple', model: 'iPad Air 4th Gen', w: 0.458, val: 13500, haz: true },
      { cat: 'CAT-MON-LED', brand: 'LG', model: 'UltraFine 27UL500 4K', w: 4.60, val: 7800, haz: false },
      { cat: 'CAT-MON-LED', brand: 'Dell', model: 'UltraSharp U2422H', w: 3.85, val: 8400, haz: false },
      { cat: 'CAT-MON-CRT', brand: 'Samsung', model: 'SyncMaster 793MB CRT', w: 14.50, val: 400, haz: true },
      { cat: 'CAT-UPS-BAT', brand: 'Luminous', model: 'Cruze+ 2KVA Inverter UPS', w: 21.60, val: 1800, haz: true },
    ];

    // Lifecycle distribution plan across 70 additional devices:
    //  0..11  -> READY_FOR_REUSE (via Repair/Refurbished or Direct Grade-A Reuse)
    // 12..15  -> REFURBISHED
    // 16..19  -> UNDER_REPAIR
    // 20..22  -> REPAIRABLE
    // 23..40  -> RECYCLED (via Dismantling + Material Recovery, or Direct Material Recovery)
    // 41..45  -> DISMANTLED (components extracted, awaiting final hull recycling)
    // 46..48  -> UNDER_DISMANTLING
    // 49..51  -> UNDER_RECYCLING
    // 52..60  -> DISPOSED (hazardous CRT / UPS / swollen battery)
    // 61..65  -> UNDER_INSPECTION
    // 66..67  -> COLLECTED
    // 68..69  -> REGISTERED

    const batchKeys = Object.keys(batchMap);

    for (let i = 0; i < 70; i++) {
      const seq = i + 6;
      const batchCode = batchKeys[i % batchKeys.length];
      const batchInfo = batchMap[batchCode];
      const baseIso = `${batchInfo.collection_date.toISOString().slice(0, 10)}T10:00:00Z`;

      // Choose an appropriate model for hazardous disposal slots
      let spec = catalogModels[i % catalogModels.length];
      if (i >= 52 && i <= 60) {
        spec = i % 2 === 0 ? catalogModels[12] : catalogModels[13]; // CRT or UPS
      } else if (i <= 19 && (spec.cat === 'CAT-MON-CRT' || spec.cat === 'CAT-UPS-BAT')) {
        spec = catalogModels[0]; // Laptop for repair/refurbish slots
      }

      const devId = await registerSeedDevice({
        seq,
        batchCode,
        catCode: spec.cat,
        brand: spec.brand,
        model: spec.model,
        serial: `${spec.brand.slice(0, 3).toUpperCase()}-SN26-${String(seq).padStart(4, '0')}`,
        year: 2018 + (i % 7),
        weight: spec.w,
        estVal: spec.val,
        grade: i >= 52 && i <= 60 ? 'HAZARDOUS' : 'GRADE_B',
        hazardous: spec.haz,
        notes: `Batch ${batchCode} intake asset (${spec.model})`,
        regIso: baseIso,
      });

      if (i >= 68) {
        // Leave in REGISTERED
        continue;
      }

      await transitionDevice(client, devId, 'COLLECTED', {
        userId: userIds['EMP-002'],
        timestamp: addHours(baseIso, 4),
        notes: 'Received & barcode-tagged at hub',
      });

      if (i >= 66) {
        // Leave in COLLECTED
        continue;
      }

      await transitionDevice(client, devId, 'UNDER_INSPECTION', {
        userId: userIds['EMP-003'],
        timestamp: addHours(baseIso, 22),
        notes: 'Queued on diagnostic inspection bench',
      });

      if (i >= 61) {
        // Leave in UNDER_INSPECTION
        continue;
      }

      // Branch 1: Direct Reuse or Refurbishment Pipeline (i = 0..22)
      if (i <= 22) {
        if (i < 3) {
          // Grade-A Direct Reuse!
          const inspId = await createInspection(devId, 'EMP-003', {
            physical: 'INTACT',
            functional: 'FULLY_WORKING',
            powerOn: true,
            batteryHealth: 91,
            hazard: false,
            grade: 'GRADE_A',
            pathway: 'DIRECT_REUSE',
            summary: 'Mint corporate lease-return condition; passed all hardware diagnostics.',
            inspectedAt: addHours(baseIso, 28),
          });
          await transitionDevice(client, devId, 'READY_FOR_REUSE', {
            userId: userIds['EMP-003'],
            referenceEntity: 'INSPECTION',
            referenceId: inspId,
            timestamp: addHours(baseIso, 30),
            notes: 'Grade-A asset cleared directly for circular reuse',
          });
          continue;
        }

        const inspId = await createInspection(devId, 'EMP-003', {
          physical: 'MINOR_WEAR',
          functional: 'HARDWARE_FAULT',
          powerOn: true,
          batteryHealth: 78,
          hazard: false,
          grade: 'GRADE_B',
          pathway: 'REPAIR',
          summary: 'Modular component fault; economically viable for bench refurbishment.',
          inspectedAt: addHours(baseIso, 28),
        });

        await transitionDevice(client, devId, 'REPAIRABLE', {
          userId: userIds['EMP-003'],
          referenceEntity: 'INSPECTION',
          referenceId: inspId,
          timestamp: addHours(baseIso, 30),
        });

        if (i >= 20) continue; // Leave in REPAIRABLE

        await transitionDevice(client, devId, 'UNDER_REPAIR', {
          userId: userIds['EMP-004'],
          timestamp: addHours(baseIso, 48),
        });

        if (i >= 16) {
          // Active open/in-progress repair ticket
          await client.query(
            `INSERT INTO repair_records
              (ticket_number, device_id, inspection_id, technician_id, issue_diagnosis,
               repair_actions, estimated_cost_inr, actual_cost_inr, repair_status, qa_verified, started_at)
             VALUES ($1,$2,$3,$4,'Thermal throttling & worn fan/SSD','Awaiting burn-in verification',1800,950,'IN_PROGRESS',FALSE,$5)`,
            [`REP-2026-${String(repSeq++).padStart(4, '0')}`, devId, inspId, userIds['EMP-004'], addHours(baseIso, 48)]
          );
          continue;
        }

        // Completed repair!
        const repRes = await client.query(
          `INSERT INTO repair_records
            (ticket_number, device_id, inspection_id, technician_id, issue_diagnosis, repair_actions,
             estimated_cost_inr, actual_cost_inr, repair_status, qa_verified, reuse_destination_org_id,
             reuse_channel, resale_value_inr, started_at, completed_at)
           VALUES ($1,$2,$3,$4,'Faulty storage/cooling module','Replaced module, repasted thermal compound, passed QA suite',2100,1450,'COMPLETED',TRUE,$5,$6,$7,$8,$9)
           RETURNING repair_id`,
          [
            `REP-2026-${String(repSeq++).padStart(4, '0')}`,
            devId,
            inspId,
            userIds['EMP-004'],
            i % 2 === 0 ? orgIds['ORG-NGO-07'] : orgIds['ORG-EDU-03'],
            i % 2 === 0 ? 'NGO_DONATION' : 'REFURBISHED_RESALE',
            Math.round(spec.val * 0.85),
            addHours(baseIso, 48),
            addHours(baseIso, 76),
          ]
        );
        await transitionDevice(client, devId, 'REFURBISHED', {
          userId: userIds['EMP-004'],
          referenceEntity: 'REPAIR',
          referenceId: repRes.rows[0].repair_id,
          timestamp: addHours(baseIso, 78),
        });

        if (i <= 11) {
          await transitionDevice(client, devId, 'READY_FOR_REUSE', {
            userId: userIds['EMP-004'],
            referenceEntity: 'REPAIR',
            referenceId: repRes.rows[0].repair_id,
            timestamp: addHours(baseIso, 96),
          });
        }
        continue;
      }

      // Branch 2: Dismantling & Material Recovery Pipeline (i = 23..51)
      if (i <= 51) {
        if (i >= 49) {
          // Direct UNDER_RECYCLING in-progress
          const inspId = await createInspection(devId, 'EMP-006', {
            physical: 'MODERATE_DAMAGE',
            functional: 'NO_POWER',
            powerOn: false,
            grade: 'NON_FUNCTIONAL',
            pathway: 'RECYCLE',
            summary: 'Obsolete damaged unit routed to bulk material recovery.',
            inspectedAt: addHours(baseIso, 28),
          });
          await transitionDevice(client, devId, 'UNDER_RECYCLING', {
            userId: userIds['EMP-005'],
            referenceEntity: 'INSPECTION',
            referenceId: inspId,
            timestamp: addHours(baseIso, 34),
          });
          continue;
        }

        const inspId = await createInspection(devId, 'EMP-006', {
          physical: 'MODERATE_DAMAGE',
          functional: 'NO_POWER',
          powerOn: false,
          hazard: spec.haz,
          grade: 'NON_FUNCTIONAL',
          pathway: 'DISMANTLE',
          summary: 'End-of-life hardware; route to dismantling bay for component harvesting & metal recovery.',
          inspectedAt: addHours(baseIso, 28),
        });

        await transitionDevice(client, devId, 'UNDER_DISMANTLING', {
          userId: userIds['EMP-005'],
          referenceEntity: 'INSPECTION',
          referenceId: inspId,
          timestamp: addHours(baseIso, 32),
        });

        if (i >= 46) continue; // Leave in UNDER_DISMANTLING

        // Create dismantling record + 3 to 4 recovered components per device!
        const dismRes = await client.query(
          `INSERT INTO dismantling_records
            (dismantling_code, device_id, operator_id, center_id, dismantling_method,
             residual_scrap_kg, dismantled_at, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Standardized component extraction & material segregation')
           RETURNING dismantling_id`,
          [
            `DISM-2026-${String(dismSeq++).padStart(4, '0')}`,
            devId,
            userIds['EMP-005'],
            batchInfo.center_id,
            i % 2 === 0 ? 'MANUAL_PRECISION' : 'SEMI_AUTOMATED',
            Number((spec.w * 0.18).toFixed(3)),
            addHours(baseIso, 52),
          ]
        );
        const dismId = dismRes.rows[0].dismantling_id;

        // Pick realistic components based on category
        const compSpecs =
          spec.cat === 'CAT-SERVER'
            ? [
                ['CMP-RAM', 'WORKING', 0.05, 3200, 'IN_INVENTORY', 'REUSE', null],
                ['CMP-RAID', 'WORKING', 0.22, 3600, 'SOLD_FOR_REUSE', 'RESALE', null],
                ['CMP-PSU', 'REPAIRABLE', 1.35, 950, 'IN_INVENTORY', 'REPAIR', null],
                ['CMP-MOBO', 'DAMAGED_RECYCLABLE', 1.40, 2100, 'RECYCLED', 'RECYCLING', facIds['FAC-MET-01']],
              ]
            : spec.cat === 'CAT-PHONE' || spec.cat === 'CAT-TABLET'
            ? [
                ['CMP-OLED', 'WORKING', 0.055, 2600, 'SOLD_FOR_REUSE', 'RESALE', null],
                ['CMP-LIBAT', 'DAMAGED_RECYCLABLE', 0.065, 190, 'RECYCLED', 'RECYCLING', facIds['FAC-BAT-02']],
                ['CMP-MOBO', 'DAMAGED_RECYCLABLE', 0.042, 650, 'RECYCLED', 'RECYCLING', facIds['FAC-MET-01']],
              ]
            : [
                ['CMP-RAM', 'WORKING', 0.025, 1600, 'IN_INVENTORY', 'REUSE', null],
                ['CMP-SSD', 'WORKING', 0.045, 2100, 'SOLD_FOR_REUSE', 'RESALE', null],
                ['CMP-COOL', 'DAMAGED_RECYCLABLE', 0.19, 310, 'RECYCLED', 'RECYCLING', facIds['FAC-MET-01']],
                ['CMP-MOBO', 'DAMAGED_RECYCLABLE', 0.41, 940, 'RECYCLED', 'RECYCLING', facIds['FAC-INT-05']],
              ];

        let lastRecycledCompId = null;
        for (const cs of compSpecs) {
          const cRes = await client.query(
            `INSERT INTO recovered_components
              (component_uid, dismantling_id, source_device_id, component_type_id, condition_status,
               weight_kg, estimated_value_inr, current_status, destination_type, recycling_facility_id,
               recovered_at, destination_notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Extracted during structured teardown')
             RETURNING recovered_component_id`,
            [
              `CMP-2026-${String(compSeq++).padStart(5, '0')}`,
              dismId,
              devId,
              compTypeIds[cs[0]],
              cs[1],
              cs[2],
              cs[3],
              cs[4],
              cs[5],
              cs[6],
              addHours(baseIso, 54),
            ]
          );
          if (cs[5] === 'RECYCLING') {
            lastRecycledCompId = cRes.rows[0].recovered_component_id;
          }
        }

        await transitionDevice(client, devId, 'DISMANTLED', {
          userId: userIds['EMP-005'],
          referenceEntity: 'DISMANTLING',
          referenceId: dismId,
          timestamp: addHours(baseIso, 56),
        });

        if (i >= 41) continue; // Leave in DISMANTLED

        // Record material recovery batches -> transition to RECYCLED!
        const recDate = addHours(baseIso, 80).slice(0, 10);
        const confDate = addHours(baseIso, 128).slice(0, 10);

        await client.query(
          `INSERT INTO material_recovery_records
            (lot_number, source_device_id, recovered_component_id, material_id, facility_id, recorded_by,
             recovered_weight_kg, purity_grade_pct, recycling_status, recovery_date, recycled_confirmed_date, certificate_ref)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,97.8,'PROCESSED_VERIFIED',$8,$9,$10),
            ($11,$2,NULL,$12,$13,$6,$14,95.2,'PROCESSED_VERIFIED',$8,$9,$15),
            ($16,$2,NULL,$17,$18,$6,$19,93.0,'PROCESSED_VERIFIED',$8,$9,$20)`,
          [
            `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
            devId,
            lastRecycledCompId,
            matIds['MAT-CU'],
            facIds['FAC-MET-01'],
            userIds['EMP-005'],
            Number((spec.w * 0.16).toFixed(4)),
            recDate,
            confDate,
            `CERT-CU-${seq}`,
            `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
             spec.w > 4 ? matIds['MAT-FE'] : matIds['MAT-AL'],
            spec.w > 4 ? facIds['FAC-SML-06'] : facIds['FAC-INT-05'],
            Number((spec.w * 0.42).toFixed(4)),
            `CERT-ST-${seq}`,
            `MAT-2026-${String(matLotSeq++).padStart(4, '0')}`,
            matIds['MAT-ABS'],
            facIds['FAC-POL-04'],
            Number((spec.w * 0.18).toFixed(4)),
            `CERT-PL-${seq}`,
          ]
        );

        await transitionDevice(client, devId, 'RECYCLED', {
          userId: userIds['EMP-005'],
          referenceEntity: 'RECYCLING',
          timestamp: addHours(baseIso, 132),
          notes: 'Downstream metal and polymer recovery verified',
        });
        continue;
      }

      // Branch 3: Authorized Hazardous Waste Disposal (i = 52..60)
      const inspId = await createInspection(devId, 'EMP-003', {
        physical: 'SWOLLEN_OR_LEAKING',
        functional: 'UNSAFE_TO_ENERGIZE',
        powerOn: false,
        hazard: true,
        hazardNotes: spec.cat === 'CAT-MON-CRT'
          ? 'Cracked leaded CRT funnel glass & mercury CCFL tube'
          : 'Sulfated lead-acid cell thermal hazard',
        grade: 'HAZARDOUS',
        pathway: 'HAZARDOUS_DISPOSAL',
        summary: 'Regulated hazardous e-waste requiring TSDF encapsulation/treatment.',
        inspectedAt: addHours(baseIso, 26),
      });

      const hazFac = i % 3 === 0 ? facIds['FAC-INT-05'] : facIds['FAC-HAZ-03'];
      const dispRes = await client.query(
        `INSERT INTO disposal_records
          (manifest_number, device_id, facility_id, authorized_by, hazard_classification,
           treatment_method, hazard_weight_kg, compliance_certificate_no, evidence_document_ref,
           disposal_cost_inr, disposed_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Authorized TSDF manifest completed')
         RETURNING disposal_id`,
        [
          `HAZ-MAN-2026-${String(dispSeq++).padStart(4, '0')}`,
          devId,
          hazFac,
          userIds['EMP-005'],
          spec.cat === 'CAT-MON-CRT' ? 'Leaded CRT Glass & Mercury Phosphor' : 'Lead-Acid Battery Electrolyte Waste',
          spec.cat === 'CAT-MON-CRT' ? 'SECURE_LANDFILL_ENCAPSULATION' : 'CHEMICAL_NEUTRALIZATION',
          Number((spec.w * 0.88).toFixed(3)),
          `TSDF-CERT-2026-${String(seq).padStart(4, '0')}`,
          `s3://reloop-manifests/2026/HAZ-${String(seq).padStart(4, '0')}.pdf`,
          Number((spec.w * 115).toFixed(2)),
          addHours(baseIso, 54),
        ]
      );

      await transitionDevice(client, devId, 'DISPOSED', {
        userId: userIds['EMP-005'],
        referenceEntity: 'DISPOSAL',
        referenceId: dispRes.rows[0].disposal_id,
        timestamp: addHours(baseIso, 58),
        notes: `Hazardous waste treated after inspection #${inspId}`,
      });
    }

    // Reset session variables before refreshing materialized view
    await setTransitionContext(client, {
      userId: null,
      referenceEntity: '',
      referenceId: null,
      notes: '',
      timestamp: '',
    });

    await client.query('COMMIT');

    // Refresh Materialized View outside transaction (CONCURRENTLY supported!)
    await client.query('CALL sp_refresh_analytics_views()');

    const summary = await client.query('SELECT * FROM vw_kpi_executive_summary');
    console.log('[Seed] Completed! Executive KPI Snapshot:', summary.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed] Failed:', err);
    throw err;
  } finally {
    client.release();
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  seedDatabase({ closePool: true }).catch(() => process.exit(1));
}

module.exports = { seedDatabase };
