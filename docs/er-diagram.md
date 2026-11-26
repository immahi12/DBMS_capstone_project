# ReLoop — Entity-Relationship Architecture & Critical Design Decisions

---

## 1. Critical Architectural Refinements Over Naive Designs

A rigorous DBMS capstone must justify **why** every entity exists and eliminate artificial or redundant tables:

1. **`collections` Refined into `collection_batches` (1:N with `devices`)**:
   - *Problem in naive schemas*: Storing donor organization, pickup date, and source channel on every device row—or creating a 1:1 `collections` row per device—duplicates pickup manifest metadata across 20 laptops collected in the same corporate pickup.
   - *Solution*: `collection_batches` captures intake manifest attributes once; `devices.collection_id` references it (`1:N`).
2. **`device_images` Omitted**:
   - *Rationale*: Storing cosmetic binary image URLs adds zero relational algebra value. Instead, compliance document references (`evidence_document_ref`, `certificate_ref`) live directly on `disposal_records` and `material_recovery_records` where regulatory evidence belongs.
3. **`inspections` + `inspection_check_results` (True 1:N Master-Detail)**:
   - *Rationale*: Rather than an artificial 1:1 split, `inspections` stores the header assessment while `inspection_check_results` stores granular subsystem tests (`Motherboard`, `Battery`, `Storage`, `Display`) with `UNIQUE (inspection_id, subsystem_name)`.
4. **Data-Driven `lifecycle_transition_rules`**:
   - *Rationale*: Encoding legal `(from_status, to_status)` edges and prerequisite flags (`requires_dismantling_record`, `requires_recycling_record`, `requires_disposal_record`) as a relational table allows PostgreSQL triggers and stored functions (`fn_get_allowed_next_statuses`) to enforce and introspect business rules declaratively.
5. **Two Many-to-Many Junction Tables**:
   - `component_material_composition (component_type_id, material_id)` models expected material mass percentages inside hardware components.
   - `facility_accepted_materials (facility_id, material_id)` models which certified facilities are licensed to process specific raw materials.
6. **Two Self-Referencing Hierarchies for Authentic `WITH RECURSIVE` Queries**:
   - `e_waste_categories.parent_category_id` → 3-level e-waste taxonomy (`Root Domain → Mid Group → Leaf Category`).
   - `recovered_components.parent_recovered_component_id` → multi-stage hardware disassembly (e.g., `Display Assembly` disassembled into `Backlight Sub-Unit` and `Anodized Aluminum Lid`).

---

## 2. Mermaid Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ COLLECTION_BATCHES : "supplies_ewaste"
    ORGANIZATIONS ||--o{ REPAIR_ RECORDS : "receives_refurbished"
    COLLECTION_CENTERS ||--o{ USERS : "employs"
    COLLECTION_CENTERS ||--o{ COLLECTION_BATCHES : "receives_at"
    COLLECTION_CENTERS ||--o{ DEVICES : "currently_stores"
    COLLECTION_CENTERS ||--o{ DISMANTLING_RECORDS : "operates_bay"
    COLLECTION_CENTERS ||--o{ DEVICE_TRANSFERS : "from_or_to"

    USERS ||--o{ COLLECTION_BATCHES : "collects"
    USERS ||--o{ DEVICES : "registers"
    USERS ||--o{ LIFECYCLE_EVENTS : "executes_transition"
    USERS ||--o{ INSPECTIONS : "inspects"
    USERS ||--o{ REPAIR_RECORDS : "repairs"
    USERS ||--o{ DISMANTLING_RECORDS : "dismantles"
    USERS ||--o{ MATERIAL_RECOVERY_RECORDS : "records_lot"
    USERS ||--o{ DISPOSAL_RECORDS : "authorizes_manifest"
    USERS ||--o{ AUDIT_LOGS : "triggers_audit"

    E_WASTE_CATEGORIES ||--o{ E_WASTE_CATEGORIES : "parent_category"
    E_WASTE_CATEGORIES ||--o{ DEVICES : "classifies"

    COLLECTION_BATCHES ||--|{ DEVICES : "contains"

    DEVICES ||--|{ LIFECYCLE_EVENTS : "logs_history"
    DEVICES ||--o{ INSPECTIONS : "undergoes"
    DEVICES ||--o{ REPAIR_RECORDS : "serviced_in"
    DEVICES ||--o| DISMANTLING_RECORDS : "dismantled_once_1_to_1"
    DEVICES ||--o{ RECOVERED_COMPONENTS : "yields_components"
    DEVICES ||--o{ MATERIAL_RECOVERY_RECORDS : "yields_materials"
    DEVICES ||--o{ DISPOSAL_RECORDS : "disposed_under"
    DEVICES ||--o{ DEVICE_TRANSFERS : "transferred_via"

    INSPECTIONS ||--|{ INSPECTION_CHECK_RESULTS : "has_subsystem_checks"
    INSPECTIONS ||--o{ REPAIR_RECORDS : "initiates"

    DISMANTLING_RECORDS ||--|{ RECOVERED_COMPONENTS : "extracts"
    COMPONENT_CATALOG ||--o{ RECOVERED_COMPONENTS : "standardizes"
    RECOVERED_COMPONENTS ||--o{ RECOVERED_COMPONENTS : "sub_disassembled_into"
    REPAIR_RECORDS ||--o{ RECOVERED_COMPONENTS : "installs_circular_part"

    COMPONENT_CATALOG ||--|{ COMPONENT_MATERIAL_COMPOSITION : "composed_of"
    MATERIALS ||--|{ COMPONENT_MATERIAL_COMPOSITION : "present_in"

    RECYCLING_FACILITIES ||--|{ FACILITY_ACCEPTED_MATERIALS : "licensed_for"
    MATERIALS ||--|{ FACILITY_ACCEPTED_MATERIALS : "accepted_at"

    MATERIALS ||--o{ MATERIAL_RECOVERY_RECORDS : "quantifies"
    RECYCLING_FACILITIES ||--o{ MATERIAL_RECOVERY_RECORDS : "processes_recovery"
    RECYCLING_FACILITIES ||--o{ DISPOSAL_RECORDS : "treats_hazard"
    RECOVERED_COMPONENTS ||--o{ MATERIAL_RECOVERY_RECORDS : "smelted_into"
    RECOVERED_COMPONENTS ||--o{ DISPOSAL_RECORDS : "disposed_as_hazard"
```

---

## 3. Cardinality Analysis Summary

| Relationship | Cardinality | Structural Justification |
| :--- | :---: | :--- |
| `devices` ↔ `dismantling_records` | **1 : 0..1 (One-to-One)** | Enforced via `dismantling_records.device_id UNIQUE NOT NULL`. A physical device can only undergo terminal structural teardown once. |
| `collection_batches` ↔ `devices` | **1 : N (One-to-Many)** | One intake pickup batch contains one or many registered devices. |
| `inspections` ↔ `inspection_check_results` | **1 : N (One-to-Many)** | Each inspection header contains multiple subsystem test rows (`ON DELETE CASCADE`). |
| `devices` ↔ `lifecycle_events` | **1 : N (One-to-Many)** | Append-only chronological history of every status change for a device. |
| `dismantling_records` ↔ `recovered_components` | **1 : N (One-to-Many)** | One teardown operation yields multiple physical components. |
| `repair_records` ↔ `recovered_components` | **1 : 0..N (One-to-Many)** | A repair job on Device B may install one or more circular components harvested from Device A. |
| `component_catalog` ↔ `materials` | **M : N (Many-to-Many)** | Resolved via `component_material_composition (component_type_id, material_id)`. |
| `recycling_facilities` ↔ `materials` | **M : N (Many-to-Many)** | Resolved via `facility_accepted_materials (facility_id, material_id)`. |
| `e_waste_categories` self-reference | **1 : N Recursive** | `parent_category_id` models multi-tier e-waste classification hierarchy. |
| `recovered_components` self-reference | **1 : N Recursive** | `parent_recovered_component_id` models sub-assembly disassembly trees. |
