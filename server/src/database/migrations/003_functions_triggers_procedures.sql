-- ============================================================================
-- ReLoop: E-Waste Lifecycle & Recycling Tracker
-- Migration 003: Stored Functions, Triggers, and Stored Procedures
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper Function: Read Optional Transaction Context Setting Safely
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_tx_actor_id(p_fallback BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    v_raw := NULLIF(TRIM(current_setting('reloop.current_user_id', TRUE)), '');
    IF v_raw IS NOT NULL THEN
        RETURN v_raw::BIGINT;
    END IF;
    RETURN p_fallback;
EXCEPTION WHEN OTHERS THEN
    RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION fn_get_tx_timestamp()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    v_raw := NULLIF(TRIM(current_setting('reloop.event_timestamp', TRUE)), '');
    IF v_raw IS NOT NULL THEN
        RETURN v_raw::TIMESTAMPTZ;
    END IF;
    RETURN NOW();
EXCEPTION WHEN OTHERS THEN
    RETURN NOW();
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Trigger Function: Validate Device Lifecycle State Machine & Prerequisites
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_device_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_rule lifecycle_transition_rules%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.current_status <> 'REGISTERED' THEN
            RAISE EXCEPTION 'New devices must begin in REGISTERED status (attempted: %)', NEW.current_status
                USING ERRCODE = 'P0001';
        END IF;
        NEW.registered_at := COALESCE(NEW.registered_at, fn_get_tx_timestamp());
        NEW.updated_at    := NEW.registered_at;
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE'
    NEW.updated_at := fn_get_tx_timestamp();

    IF OLD.current_status = NEW.current_status THEN
        RETURN NEW;
    END IF;

    -- 1. Verify state transition exists in canonical rule matrix
    SELECT *
      INTO v_rule
      FROM lifecycle_transition_rules
     WHERE from_status = OLD.current_status
       AND to_status   = NEW.current_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid lifecycle transition from % to % for device %',
            OLD.current_status, NEW.current_status, NEW.tracking_number
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Enforce Inspection Evidence Prerequisite
    IF v_rule.requires_inspection AND NOT EXISTS (
        SELECT 1 FROM inspections WHERE device_id = NEW.device_id
    ) THEN
        RAISE EXCEPTION 'Cannot transition device % to % without a recorded inspection',
            NEW.tracking_number, NEW.current_status
            USING ERRCODE = 'P0001';
    END IF;

    -- 3. Enforce QA-Verified Repair Completion Prerequisite
    IF v_rule.requires_repair_completion AND NOT EXISTS (
        SELECT 1
          FROM repair_records
         WHERE device_id     = NEW.device_id
           AND repair_status = 'COMPLETED'
           AND qa_verified   = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot transition device % to % without a QA-verified completed repair record',
            NEW.tracking_number, NEW.current_status
            USING ERRCODE = 'P0001';
    END IF;

    -- 4. Enforce Dismantling Record Prerequisite
    IF v_rule.requires_dismantling_record AND NOT EXISTS (
        SELECT 1 FROM dismantling_records WHERE device_id = NEW.device_id
    ) THEN
        RAISE EXCEPTION 'Cannot mark device % as % without a valid dismantling record',
            NEW.tracking_number, NEW.current_status
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Enforce Material Recovery / Recycling Record Prerequisite
    IF v_rule.requires_recycling_record AND NOT EXISTS (
        SELECT 1 FROM material_recovery_records WHERE source_device_id = NEW.device_id
    ) THEN
        RAISE EXCEPTION 'Cannot mark device % as RECYCLED without at least one material recovery record',
            NEW.tracking_number
            USING ERRCODE = 'P0001';
    END IF;

    -- 6. Enforce Hazardous Waste Disposal Manifest Prerequisite
    IF v_rule.requires_disposal_record AND NOT EXISTS (
        SELECT 1 FROM disposal_records WHERE device_id = NEW.device_id
    ) THEN
        RAISE EXCEPTION 'Cannot mark device % as DISPOSED without an authorized disposal record',
            NEW.tracking_number
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_device_lifecycle_transition ON devices;
CREATE TRIGGER trg_validate_device_lifecycle_transition
BEFORE INSERT OR UPDATE ON devices
FOR EACH ROW
EXECUTE FUNCTION fn_validate_device_lifecycle_transition();

-- ----------------------------------------------------------------------------
-- 3. Trigger Function: Automatically Append Immutable Lifecycle Event
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_append_device_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor_id   BIGINT;
    v_ref_entity VARCHAR(40);
    v_ref_id_raw TEXT;
    v_ref_id     BIGINT := NULL;
    v_notes      TEXT;
    v_occurred   TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.current_status = NEW.current_status THEN
        RETURN NEW;
    END IF;

    v_actor_id   := fn_get_tx_actor_id(NEW.registered_by);
    v_ref_entity := NULLIF(TRIM(current_setting('reloop.reference_entity', TRUE)), '');
    v_ref_id_raw := NULLIF(TRIM(current_setting('reloop.reference_id', TRUE)), '');
    IF v_ref_id_raw IS NOT NULL THEN
        v_ref_id := v_ref_id_raw::BIGINT;
    END IF;
    v_notes      := NULLIF(TRIM(current_setting('reloop.transition_notes', TRUE)), '');
    v_occurred   := CASE
                        WHEN TG_OP = 'INSERT' THEN NEW.registered_at
                        ELSE NEW.updated_at
                    END;

    INSERT INTO lifecycle_events (
        device_id,
        from_status,
        to_status,
        changed_by,
        center_id,
        reference_entity,
        reference_id,
        notes,
        occurred_at
    ) VALUES (
        NEW.device_id,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.current_status END,
        NEW.current_status,
        v_actor_id,
        NEW.current_center_id,
        COALESCE(v_ref_entity, CASE WHEN TG_OP = 'INSERT' THEN 'REGISTRATION' ELSE 'STATUS_TRANSITION' END),
        COALESCE(v_ref_id, CASE WHEN TG_OP = 'INSERT' THEN NEW.collection_id ELSE NULL END),
        COALESCE(v_notes, CASE
            WHEN TG_OP = 'INSERT' THEN 'Initial electronic waste registration into ReLoop'
            ELSE FORMAT('Status transitioned from %s to %s', OLD.current_status, NEW.current_status)
        END),
        v_occurred
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_append_device_lifecycle_event ON devices;
CREATE TRIGGER trg_append_device_lifecycle_event
AFTER INSERT OR UPDATE OF current_status ON devices
FOR EACH ROW
EXECUTE FUNCTION fn_append_device_lifecycle_event();

-- ----------------------------------------------------------------------------
-- 4. Trigger Function: Enforce Immutability of Lifecycle Events Ledger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_immutable_lifecycle_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Lifecycle events ledger is append-only; % on event_id % is strictly prohibited',
        TG_OP, OLD.event_id
        USING ERRCODE = 'P0002';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_immutable_lifecycle_events ON lifecycle_events;
CREATE TRIGGER trg_protect_immutable_lifecycle_events
BEFORE UPDATE OR DELETE ON lifecycle_events
FOR EACH ROW
EXECUTE FUNCTION fn_protect_immutable_lifecycle_events();

-- ----------------------------------------------------------------------------
-- 5. Trigger Function: Validate Hazardous Waste Disposal Facility Authorization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_hazardous_disposal_facility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_fac recycling_facilities%ROWTYPE;
BEGIN
    SELECT *
      INTO v_fac
      FROM recycling_facilities
     WHERE facility_id = NEW.facility_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target disposal facility % does not exist', NEW.facility_id
            USING ERRCODE = 'P0003';
    END IF;

    IF NOT v_fac.is_active OR NOT v_fac.authorized_for_hazardous THEN
        RAISE EXCEPTION 'Facility % (%) is NOT authorized for hazardous waste treatment/disposal',
            v_fac.name, v_fac.facility_code
            USING ERRCODE = 'P0003';
    END IF;

    IF v_fac.license_valid_until < (NEW.disposed_at AT TIME ZONE 'UTC')::DATE THEN
        RAISE EXCEPTION 'Facility % license expired on %; cannot accept hazardous waste',
            v_fac.name, v_fac.license_valid_until
            USING ERRCODE = 'P0003';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_hazardous_disposal_facility ON disposal_records;
CREATE TRIGGER trg_validate_hazardous_disposal_facility
BEFORE INSERT OR UPDATE ON disposal_records
FOR EACH ROW
EXECUTE FUNCTION fn_validate_hazardous_disposal_facility();

-- ----------------------------------------------------------------------------
-- 6. Trigger Function: Enforce Component Lineage Integrity & Sync Counts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_and_sync_recovered_components()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_dismantling_device_id BIGINT;
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        SELECT device_id
          INTO v_dismantling_device_id
          FROM dismantling_records
         WHERE dismantling_id = NEW.dismantling_id;

        IF v_dismantling_device_id IS DISTINCT FROM NEW.source_device_id THEN
            RAISE EXCEPTION 'Lineage integrity violation: source_device_id (%) does not match dismantling_records.device_id (%)',
                NEW.source_device_id, v_dismantling_device_id
                USING ERRCODE = 'P0004';
        END IF;

        IF NEW.parent_recovered_component_id IS NOT NULL THEN
            PERFORM 1
               FROM recovered_components
              WHERE recovered_component_id = NEW.parent_recovered_component_id
                AND source_device_id       = NEW.source_device_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Sub-component parent (%) must belong to the same source_device_id (%)',
                    NEW.parent_recovered_component_id, NEW.source_device_id
                    USING ERRCODE = 'P0004';
            END IF;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_recovered_component_lineage ON recovered_components;
CREATE TRIGGER trg_validate_recovered_component_lineage
BEFORE INSERT OR UPDATE ON recovered_components
FOR EACH ROW
EXECUTE FUNCTION fn_validate_and_sync_recovered_components();

CREATE OR REPLACE FUNCTION fn_sync_dismantling_component_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_target_dismantling_id BIGINT;
BEGIN
    v_target_dismantling_id := COALESCE(NEW.dismantling_id, OLD.dismantling_id);

    UPDATE dismantling_records d
       SET total_components_extracted = (
           SELECT COUNT(*)
             FROM recovered_components rc
            WHERE rc.dismantling_id = v_target_dismantling_id
       )
     WHERE d.dismantling_id = v_target_dismantling_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_dismantling_component_count ON recovered_components;
CREATE TRIGGER trg_sync_dismantling_component_count
AFTER INSERT OR DELETE ON recovered_components
FOR EACH ROW
EXECUTE FUNCTION fn_sync_dismantling_component_count();

-- ----------------------------------------------------------------------------
-- 7. Trigger Function: Automatic Database-Level Audit Trail (JSONB Snapshots)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_critical_tables()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_pk_col   TEXT := TG_ARGV[0];
    v_pk_val   TEXT;
    v_old_json JSONB := NULL;
    v_new_json JSONB := NULL;
    v_actor_id BIGINT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old_json := to_jsonb(OLD);
        v_pk_val   := v_old_json ->> v_pk_col;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_json := to_jsonb(NEW);
        v_pk_val   := v_new_json ->> v_pk_col;
    END IF;

    v_actor_id := fn_get_tx_actor_id(NULL);

    INSERT INTO audit_logs (
        table_name,
        record_pk,
        action_type,
        actor_user_id,
        old_payload,
        new_payload,
        ip_address,
        created_at
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(v_pk_val, 'UNKNOWN'),
        TG_OP,
        v_actor_id,
        v_old_json,
        v_new_json,
        NULLIF(TRIM(current_setting('reloop.client_ip', TRUE)), ''),
        NOW()
    );

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_devices ON devices;
CREATE TRIGGER trg_audit_devices
AFTER INSERT OR UPDATE OR DELETE ON devices
FOR EACH ROW EXECUTE FUNCTION fn_audit_critical_tables('device_id');

DROP TRIGGER IF EXISTS trg_audit_repairs ON repair_records;
CREATE TRIGGER trg_audit_repairs
AFTER INSERT OR UPDATE OR DELETE ON repair_records
FOR EACH ROW EXECUTE FUNCTION fn_audit_critical_tables('repair_id');

DROP TRIGGER IF EXISTS trg_audit_dismantling ON dismantling_records;
CREATE TRIGGER trg_audit_dismantling
AFTER INSERT OR UPDATE OR DELETE ON dismantling_records
FOR EACH ROW EXECUTE FUNCTION fn_audit_critical_tables('dismantling_id');

DROP TRIGGER IF EXISTS trg_audit_disposal ON disposal_records;
CREATE TRIGGER trg_audit_disposal
AFTER INSERT OR UPDATE OR DELETE ON disposal_records
FOR EACH ROW EXECUTE FUNCTION fn_audit_critical_tables('disposal_id');

-- ----------------------------------------------------------------------------
-- 8. Stored Function: Inspect Allowed Next Statuses & Prerequisite Readiness
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_allowed_next_statuses(p_device_id BIGINT)
RETURNS TABLE (
    to_status          VARCHAR(30),
    allowed_roles      VARCHAR(30)[],
    rule_description   VARCHAR(255),
    prerequisite_met   BOOLEAN,
    blocking_reason    TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_current_status VARCHAR(30);
    v_has_inspection BOOLEAN;
    v_has_repair     BOOLEAN;
    v_has_dismantle  BOOLEAN;
    v_has_recycling  BOOLEAN;
    v_has_disposal   BOOLEAN;
BEGIN
    SELECT d.current_status INTO v_current_status
      FROM devices d
     WHERE d.device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_has_inspection := EXISTS (SELECT 1 FROM inspections WHERE device_id = p_device_id);
    v_has_repair     := EXISTS (SELECT 1 FROM repair_records WHERE device_id = p_device_id AND repair_status = 'COMPLETED' AND qa_verified = TRUE);
    v_has_dismantle  := EXISTS (SELECT 1 FROM dismantling_records WHERE device_id = p_device_id);
    v_has_recycling  := EXISTS (SELECT 1 FROM material_recovery_records WHERE source_device_id = p_device_id);
    v_has_disposal   := EXISTS (SELECT 1 FROM disposal_records WHERE device_id = p_device_id);

    RETURN QUERY
    SELECT
        r.to_status,
        r.allowed_roles,
        r.rule_description,
        (
            (NOT r.requires_inspection         OR v_has_inspection) AND
            (NOT r.requires_repair_completion  OR v_has_repair)     AND
            (NOT r.requires_dismantling_record OR v_has_dismantle)  AND
            (NOT r.requires_recycling_record   OR v_has_recycling)  AND
            (NOT r.requires_disposal_record    OR v_has_disposal)
        ) AS prerequisite_met,
        CASE
            WHEN r.requires_inspection         AND NOT v_has_inspection THEN 'Requires an inspection record first'
            WHEN r.requires_repair_completion  AND NOT v_has_repair     THEN 'Requires QA-verified completed repair record first'
            WHEN r.requires_dismantling_record AND NOT v_has_dismantle  THEN 'Requires dismantling record first'
            WHEN r.requires_recycling_record   AND NOT v_has_recycling  THEN 'Requires material recovery record first'
            WHEN r.requires_disposal_record    AND NOT v_has_disposal   THEN 'Requires authorized hazardous disposal record first'
            ELSE NULL
        END AS blocking_reason
    FROM lifecycle_transition_rules r
    WHERE r.from_status = v_current_status
    ORDER BY r.to_status;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Stored Function: Calculate Device Circular Mass-Balance & CO2 Recovery
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_calculate_device_recovery_metrics(p_device_id BIGINT)
RETURNS TABLE (
    device_id                    BIGINT,
    tracking_number              VARCHAR(32),
    device_weight_kg             NUMERIC(8,3),
    extracted_components_count   BIGINT,
    reusable_components_count    BIGINT,
    reusable_components_kg       NUMERIC(10,3),
    materials_recovered_kg       NUMERIC(10,4),
    hazardous_disposed_kg        NUMERIC(10,3),
    mass_accounted_pct           NUMERIC(6,2),
    total_value_recovered_inr    NUMERIC(12,2),
    estimated_co2_saved_kg       NUMERIC(10,3)
)
LANGUAGE sql
STABLE
AS $$
    WITH comp_stats AS (
        SELECT
            COUNT(*) AS comp_cnt,
            COUNT(*) FILTER (WHERE destination_type IN ('REUSE', 'RESALE', 'REPAIR')) AS reusable_cnt,
            COALESCE(SUM(weight_kg) FILTER (WHERE parent_recovered_component_id IS NULL AND destination_type IN ('REUSE', 'RESALE', 'REPAIR')), 0) AS reusable_kg,
            COALESCE(SUM(estimated_value_inr) FILTER (WHERE destination_type IN ('REUSE', 'RESALE', 'REPAIR')), 0) AS comp_value_inr
        FROM recovered_components
        WHERE source_device_id = p_device_id
    ),
    mat_stats AS (
        SELECT
            COALESCE(SUM(mrr.recovered_weight_kg), 0) AS mat_kg,
            COALESCE(SUM(mrr.recovered_weight_kg * m.market_value_per_kg_inr), 0) AS mat_value_inr,
            COALESCE(SUM(mrr.recovered_weight_kg * m.co2_saved_per_kg), 0) AS co2_kg
        FROM material_recovery_records mrr
        INNER JOIN materials m ON m.material_id = mrr.material_id
        WHERE mrr.source_device_id = p_device_id
    ),
    disp_stats AS (
        SELECT COALESCE(SUM(hazard_weight_kg), 0) AS haz_kg
        FROM disposal_records
        WHERE device_id = p_device_id
    )
    SELECT
        d.device_id,
        d.tracking_number,
        d.weight_kg AS device_weight_kg,
        cs.comp_cnt AS extracted_components_count,
        cs.reusable_cnt AS reusable_components_count,
        ROUND(cs.reusable_kg::NUMERIC, 3) AS reusable_components_kg,
        ROUND(ms.mat_kg::NUMERIC, 4) AS materials_recovered_kg,
        ROUND(ds.haz_kg::NUMERIC, 3) AS hazardous_disposed_kg,
        ROUND(
            LEAST(100.0, ((cs.reusable_kg + ms.mat_kg + ds.haz_kg) / NULLIF(d.weight_kg, 0)) * 100.0)::NUMERIC,
            2
        ) AS mass_accounted_pct,
        ROUND((cs.comp_value_inr + ms.mat_value_inr)::NUMERIC, 2) AS total_value_recovered_inr,
        ROUND((ms.co2_kg + (cs.reusable_kg * 12.5))::NUMERIC, 3) AS estimated_co2_saved_kg
    FROM devices d
    CROSS JOIN comp_stats cs
    CROSS JOIN mat_stats ms
    CROSS JOIN disp_stats ds
    WHERE d.device_id = p_device_id;
$$;

-- ----------------------------------------------------------------------------
-- 10. Stored Procedure: Inter-Center Device Chain-of-Custody Transfer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_transfer_device_between_centers(
    IN p_device_id        BIGINT,
    IN p_to_center_id     BIGINT,
    IN p_actor_user_id    BIGINT,
    IN p_vehicle_manifest VARCHAR(60),
    IN p_notes            TEXT,
    INOUT p_transfer_id   BIGINT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_center_id BIGINT;
    v_transfer_code  VARCHAR(30);
BEGIN
    SELECT current_center_id
      INTO v_from_center_id
      FROM devices
     WHERE device_id = p_device_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device % not found for transfer', p_device_id USING ERRCODE = 'P0001';
    END IF;

    IF v_from_center_id = p_to_center_id THEN
        RAISE EXCEPTION 'Device is already located at target collection center %', p_to_center_id
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('reloop.current_user_id', p_actor_user_id::TEXT, TRUE);

    v_transfer_code := 'TRF-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(RANDOM() * 899999 + 100000)::TEXT, 6, '0');

    INSERT INTO device_transfers (
        transfer_code,
        device_id,
        from_center_id,
        to_center_id,
        initiated_by,
        received_by,
        transfer_status,
        vehicle_manifest,
        transferred_at,
        received_at,
        notes
    ) VALUES (
        v_transfer_code,
        p_device_id,
        v_from_center_id,
        p_to_center_id,
        p_actor_user_id,
        p_actor_user_id,
        'COMPLETED',
        p_vehicle_manifest,
        NOW(),
        NOW(),
        p_notes
    )
    RETURNING transfer_id INTO p_transfer_id;

    UPDATE devices
       SET current_center_id = p_to_center_id
     WHERE device_id = p_device_id;
END;
$$;
