-- ============================================================================
-- ReLoop: E-Waste Lifecycle & Recycling Tracker
-- Migration 001: Core Relational Schema (3NF Normalized - 21 Tables)
-- PostgreSQL 15+ / 17
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. ORGANIZATIONS
-- External/partner entities supplying e-waste or partnering in circular reuse.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    organization_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_code VARCHAR(20)  NOT NULL UNIQUE,
    name              VARCHAR(150) NOT NULL,
    org_type          VARCHAR(40)  NOT NULL
                      CHECK (org_type IN (
                          'CORPORATE',
                          'EDUCATIONAL',
                          'GOVERNMENT',
                          'RESIDENTIAL_COMMUNITY',
                          'RETAIL_PARTNER',
                          'NGO'
                      )),
    contact_person    VARCHAR(100) NOT NULL,
    contact_email     VARCHAR(150) NOT NULL UNIQUE,
    contact_phone     VARCHAR(25)  NOT NULL,
    city              VARCHAR(80)  NOT NULL,
    state             VARCHAR(80)  NOT NULL,
    address           TEXT         NOT NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. COLLECTION CENTERS
-- Physical intake, diagnostic inspection, repair, and dismantling facilities.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_centers (
    center_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    center_code          VARCHAR(20)   NOT NULL UNIQUE,
    name                 VARCHAR(150)  NOT NULL,
    city                 VARCHAR(80)   NOT NULL,
    state                VARCHAR(80)   NOT NULL,
    address              TEXT          NOT NULL,
    latitude             NUMERIC(9,6)  CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
    longitude            NUMERIC(9,6)  CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
    storage_capacity_kg  NUMERIC(10,2) NOT NULL CHECK (storage_capacity_kg > 0),
    operating_status     VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                         CHECK (operating_status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. USERS
-- Authenticated operators governed by Role-Based Access Control (RBAC).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_code      VARCHAR(20)  NOT NULL UNIQUE,
    full_name          VARCHAR(120) NOT NULL,
    email              VARCHAR(150) NOT NULL UNIQUE,
    password_hash      VARCHAR(255) NOT NULL,
    role               VARCHAR(30)  NOT NULL
                       CHECK (role IN (
                           'ADMIN',
                           'COLLECTION_MANAGER',
                           'INSPECTOR',
                           'REPAIR_OPERATOR',
                           'RECYCLING_MANAGER'
                       )),
    assigned_center_id BIGINT NULL
                       REFERENCES collection_centers(center_id)
                       ON DELETE SET NULL ON UPDATE CASCADE,
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. E-WASTE CATEGORIES (Self-Referencing Hierarchy)
-- Supports hierarchical taxonomy via parent_category_id (SELF JOIN & Recursive CTE).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS e_waste_categories (
    category_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_code           VARCHAR(25)  NOT NULL UNIQUE,
    name                    VARCHAR(100) NOT NULL UNIQUE,
    parent_category_id      BIGINT NULL
                            REFERENCES e_waste_categories(category_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    hazard_level            VARCHAR(15)  NOT NULL
                            CHECK (hazard_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    expected_lifespan_years SMALLINT     CHECK (expected_lifespan_years IS NULL OR expected_lifespan_years > 0),
    base_recyclability_pct  NUMERIC(5,2) NOT NULL
                            CHECK (base_recyclability_pct BETWEEN 0 AND 100),
    description             TEXT,
    CONSTRAINT chk_category_not_self_parent
        CHECK (parent_category_id IS NULL OR parent_category_id <> category_id)
);

-- ----------------------------------------------------------------------------
-- 5. COLLECTION BATCHES
-- Intake manifests eliminating redundant pickup metadata across bulk devices.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_batches (
    collection_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_number           VARCHAR(30)   NOT NULL UNIQUE,
    center_id              BIGINT        NOT NULL
                           REFERENCES collection_centers(center_id)
                           ON DELETE RESTRICT ON UPDATE CASCADE,
    source_organization_id BIGINT NULL
                           REFERENCES organizations(organization_id)
                           ON DELETE SET NULL ON UPDATE CASCADE,
    source_type            VARCHAR(30)   NOT NULL
                           CHECK (source_type IN (
                               'CORPORATE_BULK',
                               'INDIVIDUAL_DROP_OFF',
                               'MUNICIPAL_DRIVE',
                               'CAMPUS_COLLECTION',
                               'RETAIL_TAKEBACK'
                           )),
    collected_by_user_id   BIGINT        NOT NULL
                           REFERENCES users(user_id)
                           ON DELETE RESTRICT ON UPDATE CASCADE,
    collection_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
    declared_weight_kg     NUMERIC(10,3) CHECK (declared_weight_kg IS NULL OR declared_weight_kg >= 0),
    donor_reference        VARCHAR(120),
    pickup_notes           TEXT,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. LIFECYCLE TRANSITION RULES
-- Data-driven state machine matrix enforced inside PostgreSQL triggers.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_transition_rules (
    from_status                 VARCHAR(30)  NOT NULL,
    to_status                   VARCHAR(30)  NOT NULL,
    allowed_roles               VARCHAR(30)[] NOT NULL,
    requires_inspection         BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_repair_completion  BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_dismantling_record BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_recycling_record   BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_disposal_record    BOOLEAN      NOT NULL DEFAULT FALSE,
    rule_description            VARCHAR(255) NOT NULL,
    PRIMARY KEY (from_status, to_status),
    CONSTRAINT chk_distinct_transition_states CHECK (from_status <> to_status)
);

-- Seed canonical state-machine rules idempotently
INSERT INTO lifecycle_transition_rules (
    from_status, to_status, allowed_roles,
    requires_inspection, requires_repair_completion,
    requires_dismantling_record, requires_recycling_record, requires_disposal_record,
    rule_description
) VALUES
    ('REGISTERED',       'COLLECTED',         ARRAY['ADMIN','COLLECTION_MANAGER'],                    FALSE, FALSE, FALSE, FALSE, FALSE, 'Device physically received and verified at collection hub'),
    ('COLLECTED',        'UNDER_INSPECTION',  ARRAY['ADMIN','COLLECTION_MANAGER','INSPECTOR'],        FALSE, FALSE, FALSE, FALSE, FALSE, 'Device inducted onto diagnostic inspection bench'),
    ('UNDER_INSPECTION', 'REPAIRABLE',        ARRAY['ADMIN','INSPECTOR'],                             TRUE,  FALSE, FALSE, FALSE, FALSE, 'Inspection verified device is economically & technically repairable'),
    ('UNDER_INSPECTION', 'READY_FOR_REUSE',   ARRAY['ADMIN','INSPECTOR'],                             TRUE,  FALSE, FALSE, FALSE, FALSE, 'Grade-A functional device cleared directly for reuse'),
    ('UNDER_INSPECTION', 'UNDER_DISMANTLING', ARRAY['ADMIN','INSPECTOR','RECYCLING_MANAGER'],         TRUE,  FALSE, FALSE, FALSE, FALSE, 'Non-repairable multi-component device routed for component harvesting'),
    ('UNDER_INSPECTION', 'UNDER_RECYCLING',   ARRAY['ADMIN','INSPECTOR','RECYCLING_MANAGER'],         TRUE,  FALSE, FALSE, FALSE, FALSE, 'Device routed directly to bulk material recovery'),
    ('UNDER_INSPECTION', 'DISPOSED',          ARRAY['ADMIN','RECYCLING_MANAGER'],                     TRUE,  FALSE, FALSE, FALSE, TRUE,  'Severe acute hazard routed directly to authorized TSDF disposal'),
    ('REPAIRABLE',       'UNDER_REPAIR',      ARRAY['ADMIN','REPAIR_OPERATOR'],                       TRUE,  FALSE, FALSE, FALSE, FALSE, 'Technician opened active repair workbench job'),
    ('UNDER_REPAIR',     'REFURBISHED',       ARRAY['ADMIN','REPAIR_OPERATOR'],                       TRUE,  TRUE,  FALSE, FALSE, FALSE, 'Repair completed and post-repair QA passed'),
    ('UNDER_REPAIR',     'UNDER_DISMANTLING', ARRAY['ADMIN','REPAIR_OPERATOR','RECYCLING_MANAGER'],   TRUE,  FALSE, FALSE, FALSE, FALSE, 'Repair deemed unfeasible; escalated to component dismantling'),
    ('REFURBISHED',      'READY_FOR_REUSE',   ARRAY['ADMIN','REPAIR_OPERATOR','COLLECTION_MANAGER'],  TRUE,  TRUE,  FALSE, FALSE, FALSE, 'Refurbished unit certified for circular resale or donation'),
    ('UNDER_DISMANTLING', 'DISMANTLED',       ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, TRUE,  FALSE, FALSE, 'Dismantling completed with harvested components cataloged'),
    ('DISMANTLED',       'UNDER_RECYCLING',   ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, TRUE,  FALSE, FALSE, 'Dismantled chassis/residual hull sent to material recovery'),
    ('DISMANTLED',       'RECYCLED',          ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, TRUE,  TRUE,  FALSE, 'Dismantled device materials recovered and verified at recycler'),
    ('DISMANTLED',       'DISPOSED',          ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, TRUE,  FALSE, TRUE,  'Hazardous dismantled remainder safely disposed at TSDF'),
    ('UNDER_RECYCLING',  'RECYCLED',          ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, FALSE, TRUE,  FALSE, 'Material recovery verified at certified recycling facility'),
    ('UNDER_RECYCLING',  'DISPOSED',          ARRAY['ADMIN','RECYCLING_MANAGER'],                     FALSE, FALSE, FALSE, FALSE, TRUE,  'Non-recoverable hazardous fraction disposed with TSDF manifest')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. DEVICES
-- Central electronic asset entity tracked from collection to final destination.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    device_id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_uid                   UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    tracking_number              VARCHAR(32)   NOT NULL UNIQUE,
    collection_id                BIGINT        NOT NULL
                                 REFERENCES collection_batches(collection_id)
                                 ON DELETE RESTRICT ON UPDATE CASCADE,
    category_id                  BIGINT        NOT NULL
                                 REFERENCES e_waste_categories(category_id)
                                 ON DELETE RESTRICT ON UPDATE CASCADE,
    current_center_id            BIGINT        NOT NULL
                                 REFERENCES collection_centers(center_id)
                                 ON DELETE RESTRICT ON UPDATE CASCADE,
    brand                        VARCHAR(80)   NOT NULL,
    model_name                   VARCHAR(120)  NOT NULL,
    serial_number                VARCHAR(100)  UNIQUE,
    manufacture_year             SMALLINT      CHECK (manufacture_year IS NULL OR (manufacture_year BETWEEN 1980 AND 2030)),
    weight_kg                    NUMERIC(8,3)  NOT NULL CHECK (weight_kg > 0),
    estimated_value_inr          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (estimated_value_inr >= 0),
    current_status               VARCHAR(30)   NOT NULL DEFAULT 'REGISTERED'
                                 CHECK (current_status IN (
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
                                     'DISPOSED'
                                 )),
    condition_grade              VARCHAR(20)
                                 CHECK (condition_grade IS NULL OR condition_grade IN (
                                     'GRADE_A',
                                     'GRADE_B',
                                     'GRADE_C',
                                     'NON_FUNCTIONAL',
                                     'HAZARDOUS'
                                 )),
    contains_hazardous_materials BOOLEAN       NOT NULL DEFAULT FALSE,
    source_notes                 TEXT,
    registered_by                BIGINT        NOT NULL
                                 REFERENCES users(user_id)
                                 ON DELETE RESTRICT ON UPDATE CASCADE,
    registered_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 8. LIFECYCLE EVENTS (Append-Only Immutable History)
-- Protected by BEFORE UPDATE OR DELETE trigger so history is never overwritten.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_events (
    event_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id        BIGINT       NOT NULL
                     REFERENCES devices(device_id)
                     ON DELETE RESTRICT ON UPDATE CASCADE,
    from_status      VARCHAR(30)  NULL,
    to_status        VARCHAR(30)  NOT NULL,
    changed_by       BIGINT       NOT NULL
                     REFERENCES users(user_id)
                     ON DELETE RESTRICT ON UPDATE CASCADE,
    center_id        BIGINT       NULL
                     REFERENCES collection_centers(center_id)
                     ON DELETE SET NULL ON UPDATE CASCADE,
    reference_entity VARCHAR(40),
    reference_id     BIGINT,
    notes            TEXT,
    occurred_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 9. INSPECTIONS
-- Diagnostic assessment header for a device.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspections (
    inspection_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inspection_code      VARCHAR(30)  NOT NULL UNIQUE,
    device_id            BIGINT       NOT NULL
                         REFERENCES devices(device_id)
                         ON DELETE RESTRICT ON UPDATE CASCADE,
    inspector_id         BIGINT       NOT NULL
                         REFERENCES users(user_id)
                         ON DELETE RESTRICT ON UPDATE CASCADE,
    physical_condition   VARCHAR(30)  NOT NULL
                         CHECK (physical_condition IN ('INTACT', 'MINOR_WEAR', 'MODERATE_DAMAGE', 'SEVERE_DAMAGE', 'SWOLLEN_OR_LEAKING')),
    functional_status    VARCHAR(30)  NOT NULL
                         CHECK (functional_status IN ('FULLY_WORKING', 'PARTIAL_BOOT', 'NO_POWER', 'HARDWARE_FAULT', 'UNSAFE_TO_ENERGIZE')),
    power_on_passed      BOOLEAN      NOT NULL,
    battery_health_pct   NUMERIC(5,2) CHECK (battery_health_pct IS NULL OR (battery_health_pct BETWEEN 0 AND 100)),
    hazard_detected      BOOLEAN      NOT NULL DEFAULT FALSE,
    hazard_notes         TEXT,
    overall_grade        VARCHAR(20)  NOT NULL
                         CHECK (overall_grade IN ('GRADE_A', 'GRADE_B', 'GRADE_C', 'NON_FUNCTIONAL', 'HAZARDOUS')),
    recommended_pathway  VARCHAR(25)  NOT NULL
                         CHECK (recommended_pathway IN ('DIRECT_REUSE', 'REPAIR', 'DISMANTLE', 'RECYCLE', 'HAZARDOUS_DISPOSAL')),
    inspector_summary    TEXT         NOT NULL,
    inspected_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. INSPECTION CHECK RESULTS (1:N Detail Rows per Inspection)
-- Subsystem-level diagnostic outcomes normalizing repeating test attributes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspection_check_results (
    result_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inspection_id   BIGINT       NOT NULL
                    REFERENCES inspections(inspection_id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
    subsystem_name  VARCHAR(60)  NOT NULL,
    check_status    VARCHAR(20)  NOT NULL
                    CHECK (check_status IN ('PASS', 'DEGRADED', 'FAIL', 'HAZARDOUS', 'NOT_APPLICABLE')),
    measured_metric VARCHAR(80),
    remarks         TEXT,
    UNIQUE (inspection_id, subsystem_name)
);

-- ----------------------------------------------------------------------------
-- 11. REPAIR RECORDS
-- Tracks refurbishment & repair tickets, costs, outcomes, and circular reuse.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_records (
    repair_id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_number               VARCHAR(30)   NOT NULL UNIQUE,
    device_id                   BIGINT        NOT NULL
                                REFERENCES devices(device_id)
                                ON DELETE RESTRICT ON UPDATE CASCADE,
    inspection_id               BIGINT        NULL
                                REFERENCES inspections(inspection_id)
                                ON DELETE SET NULL ON UPDATE CASCADE,
    technician_id               BIGINT        NOT NULL
                                REFERENCES users(user_id)
                                ON DELETE RESTRICT ON UPDATE CASCADE,
    issue_diagnosis             TEXT          NOT NULL,
    repair_actions              TEXT,
    estimated_cost_inr          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (estimated_cost_inr >= 0),
    actual_cost_inr             NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (actual_cost_inr >= 0),
    repair_status               VARCHAR(30)   NOT NULL DEFAULT 'IN_PROGRESS'
                                CHECK (repair_status IN (
                                    'OPEN',
                                    'IN_PROGRESS',
                                    'COMPLETED',
                                    'UNREPAIRABLE_ESCALATED'
                                )),
    qa_verified                 BOOLEAN       NOT NULL DEFAULT FALSE,
    reuse_destination_org_id    BIGINT        NULL
                                REFERENCES organizations(organization_id)
                                ON DELETE SET NULL ON UPDATE CASCADE,
    reuse_channel               VARCHAR(30)
                                CHECK (reuse_channel IS NULL OR reuse_channel IN (
                                    'REFURBISHED_RESALE',
                                    'NGO_DONATION',
                                    'EDUCATIONAL_GRANT',
                                    'INTERNAL_REDEPLOYMENT'
                                )),
    resale_value_inr            NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (resale_value_inr >= 0),
    started_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at                TIMESTAMPTZ   NULL,
    CONSTRAINT chk_repair_completion_dates
        CHECK (completed_at IS NULL OR completed_at >= started_at),
    CONSTRAINT chk_completed_requires_qa
        CHECK (repair_status <> 'COMPLETED' OR qa_verified = TRUE)
);

-- ----------------------------------------------------------------------------
-- 12. COMPONENT CATALOG
-- Standardized master catalog of extractable hardware component types.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_catalog (
    component_type_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_code              VARCHAR(25)   NOT NULL UNIQUE,
    name                   VARCHAR(100)  NOT NULL UNIQUE,
    component_group        VARCHAR(40)   NOT NULL
                           CHECK (component_group IN (
                               'MEMORY',
                               'STORAGE',
                               'POWER_BATTERY',
                               'DISPLAY',
                               'CIRCUIT_BOARD',
                               'THERMAL_COOLING',
                               'CHASSIS_STRUCTURAL',
                               'INPUT_PERIPHERAL',
                               'OPTICAL_CAMERA',
                               'MOTOR_ACTUATOR'
                           )),
    is_hazardous_default   BOOLEAN       NOT NULL DEFAULT FALSE,
    reusability_score      SMALLINT      NOT NULL CHECK (reusability_score BETWEEN 1 AND 10),
    typical_weight_kg      NUMERIC(8,3)  NOT NULL CHECK (typical_weight_kg > 0),
    benchmark_value_inr    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (benchmark_value_inr >= 0),
    handling_instructions  TEXT
);

-- ----------------------------------------------------------------------------
-- 13. RECYCLING FACILITIES
-- Certified material recovery smelters, refineries, and hazardous TSDF plants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recycling_facilities (
    facility_id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_code                  VARCHAR(25)   NOT NULL UNIQUE,
    name                           VARCHAR(150)  NOT NULL,
    facility_type                  VARCHAR(40)   NOT NULL
                                   CHECK (facility_type IN (
                                       'METAL_SMELTER',
                                       'POLYMER_RECYCLER',
                                       'PRECIOUS_METAL_REFINERY',
                                       'BATTERY_HYDROMETALLURGY',
                                       'AUTHORIZED_TSDF_HAZARDOUS',
                                       'INTEGRATED_EWASTE_PLANT'
                                   )),
    certification_number           VARCHAR(60)   NOT NULL UNIQUE,
    license_valid_until            DATE          NOT NULL,
    city                           VARCHAR(80)   NOT NULL,
    state                          VARCHAR(80)   NOT NULL,
    processing_capacity_tons_month NUMERIC(10,2) NOT NULL CHECK (processing_capacity_tons_month > 0),
    authorized_for_hazardous       BOOLEAN       NOT NULL DEFAULT FALSE,
    contact_email                  VARCHAR(150)  NOT NULL,
    contact_phone                  VARCHAR(25)   NOT NULL,
    is_active                      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 14. DISMANTLING RECORDS (True 1:1 Relationship with Dismantled Device)
-- A physical device can only undergo terminal structural dismantling once.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dismantling_records (
    dismantling_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dismantling_code           VARCHAR(30)  NOT NULL UNIQUE,
    device_id                  BIGINT       NOT NULL UNIQUE
                               REFERENCES devices(device_id)
                               ON DELETE RESTRICT ON UPDATE CASCADE,
    operator_id                BIGINT       NOT NULL
                               REFERENCES users(user_id)
                               ON DELETE RESTRICT ON UPDATE CASCADE,
    center_id                  BIGINT       NOT NULL
                               REFERENCES collection_centers(center_id)
                               ON DELETE RESTRICT ON UPDATE CASCADE,
    dismantling_method         VARCHAR(35)  NOT NULL
                               CHECK (dismantling_method IN (
                                   'MANUAL_PRECISION',
                                   'SEMI_AUTOMATED',
                                   'THERMAL_DEPOPULATION_PREP'
                               )),
    safety_protocol_verified   BOOLEAN      NOT NULL DEFAULT TRUE,
    total_components_extracted INTEGER      NOT NULL DEFAULT 0 CHECK (total_components_extracted >= 0),
    residual_scrap_kg          NUMERIC(8,3) NOT NULL DEFAULT 0 CHECK (residual_scrap_kg >= 0),
    dismantled_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    notes                      TEXT
);

-- ----------------------------------------------------------------------------
-- 15. RECOVERED COMPONENTS (Component-Level Traceability + Sub-Assembly Tree)
-- Preserves permanent link to source_device_id, dismantling_id, optional parent
-- sub-assembly, repair reuse target, or downstream recycling/disposal.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovered_components (
    recovered_component_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_uid                 VARCHAR(32)   NOT NULL UNIQUE,
    dismantling_id                BIGINT        NOT NULL
                                  REFERENCES dismantling_records(dismantling_id)
                                  ON DELETE RESTRICT ON UPDATE CASCADE,
    source_device_id              BIGINT        NOT NULL
                                  REFERENCES devices(device_id)
                                  ON DELETE RESTRICT ON UPDATE CASCADE,
    component_type_id             BIGINT        NOT NULL
                                  REFERENCES component_catalog(component_type_id)
                                  ON DELETE RESTRICT ON UPDATE CASCADE,
    parent_recovered_component_id BIGINT        NULL
                                  REFERENCES recovered_components(recovered_component_id)
                                  ON DELETE RESTRICT ON UPDATE CASCADE,
    serial_or_part_no             VARCHAR(80),
    condition_status              VARCHAR(25)   NOT NULL
                                  CHECK (condition_status IN (
                                      'WORKING',
                                      'REPAIRABLE',
                                      'DAMAGED_RECYCLABLE',
                                      'HAZARDOUS_INTACT',
                                      'HAZARDOUS_LEAKING'
                                  )),
    weight_kg                     NUMERIC(8,3)  NOT NULL CHECK (weight_kg > 0),
    estimated_value_inr           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (estimated_value_inr >= 0),
    current_status                VARCHAR(30)   NOT NULL DEFAULT 'IN_INVENTORY'
                                  CHECK (current_status IN (
                                      'EXTRACTED',
                                      'IN_INVENTORY',
                                      'ALLOCATED_TO_REPAIR',
                                      'REUSED_IN_DEVICE',
                                      'SOLD_FOR_REUSE',
                                      'SENT_FOR_RECYCLING',
                                      'RECYCLED',
                                      'HAZARDOUS_DISPOSED'
                                  )),
    destination_type              VARCHAR(25)   NOT NULL
                                  CHECK (destination_type IN (
                                      'REUSE',
                                      'RESALE',
                                      'REPAIR',
                                      'RECYCLING',
                                      'HAZARDOUS_DISPOSAL'
                                  )),
    installed_in_repair_id        BIGINT        NULL
                                  REFERENCES repair_records(repair_id)
                                  ON DELETE SET NULL ON UPDATE CASCADE,
    recycling_facility_id         BIGINT        NULL
                                  REFERENCES recycling_facilities(facility_id)
                                  ON DELETE SET NULL ON UPDATE CASCADE,
    recovered_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    destination_notes             TEXT,
    CONSTRAINT chk_component_not_self_parent
        CHECK (parent_recovered_component_id IS NULL OR parent_recovered_component_id <> recovered_component_id)
);

-- ----------------------------------------------------------------------------
-- 16. MATERIALS
-- Master table of raw metals, polymers, glass, and regulated hazardous elements.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    material_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_code           VARCHAR(20)   NOT NULL UNIQUE,
    name                    VARCHAR(80)   NOT NULL UNIQUE,
    material_class          VARCHAR(30)   NOT NULL
                            CHECK (material_class IN (
                                'PRECIOUS_METAL',
                                'BASE_METAL',
                                'FERROUS_METAL',
                                'POLYMER_PLASTIC',
                                'GLASS_CERAMIC',
                                'BATTERY_CHEMISTRY',
                                'TOXIC_HEAVY_METAL'
                            )),
    is_hazardous            BOOLEAN       NOT NULL DEFAULT FALSE,
    market_value_per_kg_inr NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (market_value_per_kg_inr >= 0),
    co2_saved_per_kg        NUMERIC(8,3)  NOT NULL DEFAULT 0 CHECK (co2_saved_per_kg >= 0)
);

-- ----------------------------------------------------------------------------
-- 17. COMPONENT MATERIAL COMPOSITION (Many-to-Many Junction Table #1)
-- Maps expected material fractions inside each component_catalog item.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_material_composition (
    component_type_id BIGINT       NOT NULL
                      REFERENCES component_catalog(component_type_id)
                      ON DELETE CASCADE ON UPDATE CASCADE,
    material_id       BIGINT       NOT NULL
                      REFERENCES materials(material_id)
                      ON DELETE RESTRICT ON UPDATE CASCADE,
    typical_mass_pct  NUMERIC(5,2) NOT NULL
                      CHECK (typical_mass_pct > 0 AND typical_mass_pct <= 100),
    PRIMARY KEY (component_type_id, material_id)
);

-- ----------------------------------------------------------------------------
-- 18. FACILITY ACCEPTED MATERIALS (Many-to-Many Junction Table #2)
-- Maps which materials a recycling_facility is licensed to recover/treat.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_accepted_materials (
    facility_id             BIGINT       NOT NULL
                            REFERENCES recycling_facilities(facility_id)
                            ON DELETE CASCADE ON UPDATE CASCADE,
    material_id             BIGINT       NOT NULL
                            REFERENCES materials(material_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    recovery_efficiency_pct NUMERIC(5,2) NOT NULL
                            CHECK (recovery_efficiency_pct BETWEEN 0 AND 100),
    PRIMARY KEY (facility_id, material_id)
);

-- ----------------------------------------------------------------------------
-- 19. MATERIAL RECOVERY RECORDS
-- Tracks physical material weights extracted from devices/components & recycled.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_recovery_records (
    recovery_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_number              VARCHAR(30)    NOT NULL UNIQUE,
    source_device_id        BIGINT         NOT NULL
                            REFERENCES devices(device_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    recovered_component_id  BIGINT         NULL
                            REFERENCES recovered_components(recovered_component_id)
                            ON DELETE SET NULL ON UPDATE CASCADE,
    material_id             BIGINT         NOT NULL
                            REFERENCES materials(material_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    facility_id             BIGINT         NOT NULL
                            REFERENCES recycling_facilities(facility_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    recorded_by             BIGINT         NOT NULL
                            REFERENCES users(user_id)
                            ON DELETE RESTRICT ON UPDATE CASCADE,
    recovered_weight_kg     NUMERIC(10,4)  NOT NULL CHECK (recovered_weight_kg > 0),
    purity_grade_pct        NUMERIC(5,2)   CHECK (purity_grade_pct IS NULL OR (purity_grade_pct BETWEEN 0 AND 100)),
    recycling_status        VARCHAR(25)    NOT NULL DEFAULT 'DISPATCHED'
                            CHECK (recycling_status IN (
                                'PENDING_DISPATCH',
                                'DISPATCHED',
                                'PROCESSED_VERIFIED'
                            )),
    recovery_date           DATE           NOT NULL DEFAULT CURRENT_DATE,
    recycled_confirmed_date DATE           NULL,
    certificate_ref         VARCHAR(60),
    notes                   TEXT,
    CONSTRAINT chk_material_recycling_dates
        CHECK (recycled_confirmed_date IS NULL OR recycled_confirmed_date >= recovery_date)
);

-- ----------------------------------------------------------------------------
-- 20. DISPOSAL RECORDS
-- Regulatory manifests for hazardous e-waste sent to authorized TSDF facilities.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disposal_records (
    disposal_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manifest_number           VARCHAR(35)   NOT NULL UNIQUE,
    device_id                 BIGINT        NOT NULL
                              REFERENCES devices(device_id)
                              ON DELETE RESTRICT ON UPDATE CASCADE,
    recovered_component_id    BIGINT        NULL
                              REFERENCES recovered_components(recovered_component_id)
                              ON DELETE SET NULL ON UPDATE CASCADE,
    facility_id               BIGINT        NOT NULL
                              REFERENCES recycling_facilities(facility_id)
                              ON DELETE RESTRICT ON UPDATE CASCADE,
    authorized_by             BIGINT        NOT NULL
                              REFERENCES users(user_id)
                              ON DELETE RESTRICT ON UPDATE CASCADE,
    hazard_classification     VARCHAR(80)   NOT NULL,
    treatment_method          VARCHAR(45)   NOT NULL
                              CHECK (treatment_method IN (
                                  'SECURE_LANDFILL_ENCAPSULATION',
                                  'HIGH_TEMP_INCINERATION',
                                  'CHEMICAL_NEUTRALIZATION',
                                  'AUTOCLAVE_IMMOBILIZATION'
                              )),
    hazard_weight_kg          NUMERIC(8,3)  NOT NULL CHECK (hazard_weight_kg > 0),
    compliance_certificate_no VARCHAR(60)   NOT NULL UNIQUE,
    evidence_document_ref     VARCHAR(255)  NOT NULL,
    disposal_cost_inr         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (disposal_cost_inr >= 0),
    disposed_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    notes                     TEXT
);

-- ----------------------------------------------------------------------------
-- 21. DEVICE TRANSFERS & AUDIT LOGS (Chain of Custody + System Auditability)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_transfers (
    transfer_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_code   VARCHAR(30) NOT NULL UNIQUE,
    device_id       BIGINT      NOT NULL
                    REFERENCES devices(device_id)
                    ON DELETE RESTRICT ON UPDATE CASCADE,
    from_center_id  BIGINT      NOT NULL
                    REFERENCES collection_centers(center_id)
                    ON DELETE RESTRICT ON UPDATE CASCADE,
    to_center_id    BIGINT      NOT NULL
                    REFERENCES collection_centers(center_id)
                    ON DELETE RESTRICT ON UPDATE CASCADE,
    initiated_by    BIGINT      NOT NULL
                    REFERENCES users(user_id)
                    ON DELETE RESTRICT ON UPDATE CASCADE,
    received_by     BIGINT      NULL
                    REFERENCES users(user_id)
                    ON DELETE RESTRICT ON UPDATE CASCADE,
    transfer_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'
                    CHECK (transfer_status IN ('IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
    vehicle_manifest VARCHAR(60),
    transferred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at     TIMESTAMPTZ NULL,
    notes           TEXT,
    CONSTRAINT chk_distinct_transfer_centers CHECK (from_center_id <> to_center_id)
);

-- Justified JSONB usage: heterogeneous row snapshots across multiple audited tables.
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name    VARCHAR(60) NOT NULL,
    record_pk     VARCHAR(64) NOT NULL,
    action_type   VARCHAR(25) NOT NULL
                  CHECK (action_type IN ('INSERT', 'UPDATE', 'DELETE', 'AUTH_LOGIN', 'RBAC_DENIED')),
    actor_user_id BIGINT      NULL
                  REFERENCES users(user_id)
                  ON DELETE SET NULL ON UPDATE CASCADE,
    old_payload   JSONB       NULL,
    new_payload   JSONB       NULL,
    ip_address    VARCHAR(45),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
