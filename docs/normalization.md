# ReLoop — Relational Normalization Analysis (1NF → 2NF → 3NF)

---

## 1. Design Philosophy

ReLoop's PostgreSQL schema is designed from first principles to satisfy **First Normal Form (1NF)**, **Second Normal Form (2NF)**, and **Third Normal Form (3NF)** (and Boyce-Codd Normal Form across all core operational relations), eliminating update, insertion, and deletion anomalies.

---

## 2. First Normal Form (1NF) — Atomicity & Repeating Groups

**Rule**: Every attribute domain contains atomic (indivisible) scalar values, every tuple is uniquely identified by a primary key, and there are no repeating column groups (`component_1`, `component_2`, `material_csv`, etc.).

### How ReLoop Enforces 1NF:
1. **Subsystem Inspection Checks**: Instead of storing `screen_check`, `battery_check`, `ram_check` columns or a comma-separated string on `inspections`, repeating checks are decomposed into `inspection_check_results(result_id, inspection_id, subsystem_name, check_status, measured_metric)` with `UNIQUE(inspection_id, subsystem_name)`.
2. **Facility Accepted Materials**: Instead of storing `accepted_materials = 'Copper,Gold,Lead'` on `recycling_facilities` (which violates 1NF and prevents foreign-key validation), we decompose into `facility_accepted_materials(facility_id, material_id, recovery_efficiency_pct)`.
3. **Component Composition**: Decomposed into `component_material_composition(component_type_id, material_id, typical_mass_pct)`.
4. **Justified Exception Notes**:
   - `lifecycle_transition_rules.allowed_roles VARCHAR(30)[]` is used strictly as a static RBAC configuration set on a system rule lookup table.
   - `audit_logs.old_payload / new_payload JSONB` is genuinely justified because an audit log archives immutable historical row snapshots across heterogeneous tables with differing schemas.

---

## 3. Second Normal Form (2NF) — Elimination of Partial Dependencies

**Rule**: The relation is in 1NF, and every non-prime attribute is **fully functionally dependent** on the **entire** candidate/primary key (no partial dependency on a proper subset of a composite primary key).

### Verification on Composite-Key Tables:
1. **`component_material_composition`** — Composite PK: `(component_type_id, material_id)`
   - Functional Dependency: `{component_type_id, material_id} → typical_mass_pct`
   - Neither `component_type_id` alone nor `material_id` alone determines `typical_mass_pct` (Copper is 68% of a Copper Heatsink but only 14% of a Li-Ion Battery). Component name (`name`, `typical_weight_kg`) lives in `component_catalog`; material price (`market_value_per_kg_inr`) lives in `materials`. **Strictly 2NF.**
2. **`facility_accepted_materials`** — Composite PK: `(facility_id, material_id)`
   - Functional Dependency: `{facility_id, material_id} → recovery_efficiency_pct`
   - Recovery efficiency depends jointly on BOTH the specific smelter plant AND the specific material being refined. Facility address/license lives in `recycling_facilities`; material hazard class lives in `materials`. **Strictly 2NF.**
3. **`lifecycle_transition_rules`** — Composite PK: `(from_status, to_status)`
   - Functional Dependency: `{from_status, to_status} → {allowed_roles, requires_inspection, ..., rule_description}`
   - Every prerequisite flag depends on the specific directed edge `(from_status, to_status)`, never on `from_status` or `to_status` alone. **Strictly 2NF.**
4. All remaining 18 tables use single-attribute identity surrogate primary keys (`BIGINT GENERATED ALWAYS AS IDENTITY`), so partial key dependencies are structurally impossible.

---

## 4. Third Normal Form (3NF) — Elimination of Transitive Dependencies

**Rule**: The relation is in 2NF, and for every non-trivial functional dependency $X \rightarrow A$, either $X$ is a superkey or $A$ is a prime attribute (no non-key attribute determines another non-key attribute: $PK \rightarrow Y \rightarrow Z$ is prohibited).

### Concrete Transitive Dependencies Eliminated in ReLoop:

1. **`devices` vs `collection_batches` vs `organizations`**:
   - *Unnormalized trap*: Storing `collection_date`, `source_type`, `donor_org_name`, `donor_contact_email` inside `devices` creates transitive chains:
     `device_id → collection_id → {collection_date, source_organization_id}` and `source_organization_id → {donor_org_name, contact_email}`.
   - *3NF Decomposition*:
     - `devices`: `device_id → collection_id`
     - `collection_batches`: `collection_id → {collection_date, source_type, center_id, source_organization_id}`
     - `organizations`: `organization_id → {name, org_type, contact_person, contact_email, city, state}`
   - Updating an organization's contact email updates **one** row in `organizations` with zero update anomalies.

2. **`recovered_components` vs `component_catalog`**:
   - *Unnormalized trap*: Storing `component_group`, `is_hazardous_default`, and `handling_instructions` on every harvested component row creates `recovered_component_id → component_type_id → {component_group, handling_instructions}`.
   - *3NF Decomposition*: Standardized type attributes reside in `component_catalog`, while `recovered_components` stores only instance-specific facts (`component_uid`, `condition_status`, `weight_kg`, `estimated_value_inr`, `current_status`, `destination_type`).

3. **`material_recovery_records` vs `materials`**:
   - *Unnormalized trap*: Storing `material_value_inr` or `co2_saved_total_kg` statically or repeating `market_value_per_kg_inr` inside `material_recovery_records` introduces transitive/derived redundancy (`material_id → market_value_per_kg_inr`).
   - *3NF Decomposition*: Unit valuation and CO₂ factors live in `materials`; `material_recovery_records` stores `recovered_weight_kg` and `purity_grade_pct`, while total valuation and CO₂ savings are dynamically computed in SQL views (`vw_kpi_executive_summary`, `vw_facility_performance_metrics`).

---

## 5. Controlled Trigger-Maintained Counter Note

`dismantling_records.total_components_extracted` is maintained automatically by an `AFTER INSERT OR DELETE ON recovered_components` PostgreSQL trigger (`trg_sync_dismantling_component_count`). This provides $O(1)$ read access on dismantling manifests while guaranteeing zero drift from `COUNT(recovered_components)` at the database transaction boundary.
