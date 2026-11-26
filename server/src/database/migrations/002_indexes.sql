-- ============================================================================
-- ReLoop: E-Waste Lifecycle & Recycling Tracker
-- Migration 002: Standard, Composite, and Partial Indexes for Query Optimization
-- ============================================================================

-- 1. Foreign Key & Frequent Join Indexes
CREATE INDEX IF NOT EXISTS idx_users_center
    ON users (assigned_center_id);

CREATE INDEX IF NOT EXISTS idx_categories_parent
    ON e_waste_categories (parent_category_id);

CREATE INDEX IF NOT EXISTS idx_collections_center_date
    ON collection_batches (center_id, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_collections_org
    ON collection_batches (source_organization_id);

CREATE INDEX IF NOT EXISTS idx_devices_collection
    ON devices (collection_id);

CREATE INDEX IF NOT EXISTS idx_devices_category
    ON devices (category_id);

CREATE INDEX IF NOT EXISTS idx_inspections_device_date
    ON inspections (device_id, inspected_at DESC);

CREATE INDEX IF NOT EXISTS idx_repairs_device_status
    ON repair_records (device_id, repair_status);

CREATE INDEX IF NOT EXISTS idx_components_source_device
    ON recovered_components (source_device_id);

CREATE INDEX IF NOT EXISTS idx_components_dismantling
    ON recovered_components (dismantling_id);

CREATE INDEX IF NOT EXISTS idx_components_parent
    ON recovered_components (parent_recovered_component_id);

CREATE INDEX IF NOT EXISTS idx_mat_recovery_device
    ON material_recovery_records (source_device_id);

CREATE INDEX IF NOT EXISTS idx_disposal_device
    ON disposal_records (device_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created
    ON audit_logs (table_name, created_at DESC);

-- 2. Composite Indexes (Multi-column query predicates + Window Function ordering)
CREATE INDEX IF NOT EXISTS idx_devices_status_center_registered
    ON devices (current_status, current_center_id, registered_at DESC);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_device_occurred
    ON lifecycle_events (device_id, occurred_at ASC, event_id ASC);

CREATE INDEX IF NOT EXISTS idx_mat_recovery_facility_status_date
    ON material_recovery_records (facility_id, recycling_status, recovery_date DESC);

-- 3. Partial Indexes (High-selectivity subsets solving operational bottlenecks)

-- Targets only active in-flight devices (excludes terminal completed outcomes)
CREATE INDEX IF NOT EXISTS idx_devices_active_pipeline_partial
    ON devices (current_center_id, current_status, registered_at DESC)
    WHERE current_status NOT IN ('READY_FOR_REUSE', 'RECYCLED', 'DISPOSED');

-- Rapid compliance lookup for hazardous devices not yet safely disposed
CREATE INDEX IF NOT EXISTS idx_devices_hazardous_pending_partial
    ON devices (current_center_id, current_status)
    WHERE contains_hazardous_materials = TRUE AND current_status <> 'DISPOSED';

-- Rapid spare-parts inventory lookup for repair operators
CREATE INDEX IF NOT EXISTS idx_components_reusable_stock_partial
    ON recovered_components (component_type_id, estimated_value_inr DESC)
    WHERE current_status = 'IN_INVENTORY'
      AND condition_status IN ('WORKING', 'REPAIRABLE');
