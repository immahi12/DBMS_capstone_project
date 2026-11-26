# ReLoop — Relational Schema & Data Dictionary

---

## 1. Relational Schema Notation (21 Domain Tables)

1. `organizations`(**organization_id**, organization_code [UQ], name, org_type, contact_person, contact_email [UQ], contact_phone, city, state, address, is_active, created_at)
2. `collection_centers`(**center_id**, center_code [UQ], name, city, state, address, latitude, longitude, storage_capacity_kg, operating_status, created_at)
3. `users`(**user_id**, employee_code [UQ], full_name, email [UQ], password_hash, role, *assigned_center_id* → `collection_centers`, is_active, last_login_at, created_at)
4. `e_waste_categories`(**category_id**, category_code [UQ], name [UQ], *parent_category_id* → `e_waste_categories`, hazard_level, expected_lifespan_years, base_recyclability_pct, description)
5. `collection_batches`(**collection_id**, batch_number [UQ], *center_id* → `collection_centers`, *source_organization_id* → `organizations`, source_type, *collected_by_user_id* → `users`, collection_date, declared_weight_kg, donor_reference, pickup_notes, created_at)
6. `lifecycle_transition_rules`(**from_status**, **to_status**, allowed_roles, requires_inspection, requires_repair_completion, requires_dismantling_record, requires_recycling_record, requires_disposal_record, rule_description)
7. `devices`(**device_id**, device_uid [UQ], tracking_number [UQ], *collection_id* → `collection_batches`, *category_id* → `e_waste_categories`, *current_center_id* → `collection_centers`, brand, model_name, serial_number [UQ], manufacture_year, weight_kg, estimated_value_inr, current_status, condition_grade, contains_hazardous_materials, source_notes, *registered_by* → `users`, registered_at, updated_at)
8. `lifecycle_events`(**event_id**, *device_id* → `devices`, from_status, to_status, *changed_by* → `users`, *center_id* → `collection_centers`, reference_entity, reference_id, notes, occurred_at)
9. `inspections`(**inspection_id**, inspection_code [UQ], *device_id* → `devices`, *inspector_id* → `users`, physical_condition, functional_status, power_on_passed, battery_health_pct, hazard_detected, hazard_notes, overall_grade, recommended_pathway, inspector_summary, inspected_at)
10. `inspection_check_results`(**result_id**, *inspection_id* → `inspections`, subsystem_name, check_status, measured_metric, remarks) — `UNIQUE(inspection_id, subsystem_name)`
11. `repair_records`(**repair_id**, ticket_number [UQ], *device_id* → `devices`, *inspection_id* → `inspections`, *technician_id* → `users`, issue_diagnosis, repair_actions, estimated_cost_inr, actual_cost_inr, repair_status, qa_verified, *reuse_destination_org_id* → `organizations`, reuse_channel, resale_value_inr, started_at, completed_at)
12. `component_catalog`(**component_type_id**, type_code [UQ], name [UQ], component_group, is_hazardous_default, reusability_score, typical_weight_kg, benchmark_value_inr, handling_instructions)
13. `recycling_facilities`(**facility_id**, facility_code [UQ], name, facility_type, certification_number [UQ], license_valid_until, city, state, processing_capacity_tons_month, authorized_for_hazardous, contact_email, contact_phone, is_active, created_at)
14. `dismantling_records`(**dismantling_id**, dismantling_code [UQ], *device_id* [UQ] → `devices`, *operator_id* → `users`, *center_id* → `collection_centers`, dismantling_method, safety_protocol_verified, total_components_extracted, residual_scrap_kg, dismantled_at, notes)
15. `recovered_components`(**recovered_component_id**, component_uid [UQ], *dismantling_id* → `dismantling_records`, *source_device_id* → `devices`, *component_type_id* → `component_catalog`, *parent_recovered_component_id* → `recovered_components`, serial_or_part_no, condition_status, weight_kg, estimated_value_inr, current_status, destination_type, *installed_in_repair_id* → `repair_records`, *recycling_facility_id* → `recycling_facilities`, recovered_at, destination_notes)
16. `materials`(**material_id**, material_code [UQ], name [UQ], material_class, is_hazardous, market_value_per_kg_inr, co2_saved_per_kg)
17. `component_material_composition`(**component_type_id** → `component_catalog`, **material_id** → `materials`, typical_mass_pct)
18. `facility_accepted_materials`(**facility_id** → `recycling_facilities`, **material_id** → `materials`, recovery_efficiency_pct)
19. `material_recovery_records`(**recovery_id**, lot_number [UQ], *source_device_id* → `devices`, *recovered_component_id* → `recovered_components`, *material_id* → `materials`, *facility_id* → `recycling_facilities`, *recorded_by* → `users`, recovered_weight_kg, purity_grade_pct, recycling_status, recovery_date, recycled_confirmed_date, certificate_ref, notes)
20. `disposal_records`(**disposal_id**, manifest_number [UQ], *device_id* → `devices`, *recovered_component_id* → `recovered_components`, *facility_id* → `recycling_facilities`, *authorized_by* → `users`, hazard_classification, treatment_method, hazard_weight_kg, compliance_certificate_no [UQ], evidence_document_ref, disposal_cost_inr, disposed_at, notes)
21. `device_transfers`(**transfer_id**, transfer_code [UQ], *device_id* → `devices`, *from_center_id* → `collection_centers`, *to_center_id* → `collection_centers`, *initiated_by* → `users`, *received_by* → `users`, transfer_status, vehicle_manifest, transferred_at, received_at, notes)
22. `audit_logs`(**log_id**, table_name, record_pk, action_type, *actor_user_id* → `users`, old_payload [JSONB], new_payload [JSONB], ip_address, created_at)

---

## 2. Referential Action Strategy (`ON DELETE` & `ON UPDATE`)

- **`ON DELETE RESTRICT`** is applied to core provenance foreign keys (`devices.collection_id`, `lifecycle_events.device_id`, `recovered_components.source_device_id`, `material_recovery_records.source_device_id`, `disposal_records.device_id`, `disposal_records.facility_id`). In an environmental compliance system, deleting a parent device or facility that has downstream recycling or hazardous disposal manifests would destroy legal chain-of-custody records.
- **`ON DELETE CASCADE`** is used exclusively on weak/dependent child compositions where child rows have no independent existence outside their parent (`inspection_check_results.inspection_id`, `component_material_composition.component_type_id`, `facility_accepted_materials.facility_id`).
- **`ON DELETE SET NULL`** is used on optional associations (`users.assigned_center_id`, `collection_batches.source_organization_id`, `recovered_components.installed_in_repair_id`, `audit_logs.actor_user_id`) so historical logs survive organizational or staff reassignment.
- **`ON UPDATE CASCADE`** ensures surrogate/natural key updates propagate safely where applicable.

---

## 3. PostgreSQL Database Objects Summary

### Views & Materialized Views
- `vw_device_master_overview` — Enriched 6-table operational view of devices, categories, batches, donors, and hubs.
- `vw_component_full_lineage` — Full component-level lineage joining source device, dismantling record, parent sub-assembly, target reuse device, smelter, and TSDF manifest.
- `vw_kpi_executive_summary` — Single-row real-time KPI calculation avoiding device/component double-counting.
- `vw_center_performance_metrics` — Collection center throughput & active storage utilization.
- `vw_facility_performance_metrics` — Smelter/TSDF recovered mass, purity, economic value, and CO₂ offset.
- `mv_monthly_ewaste_summary` — Materialized view indexed uniquely on `(month_bucket, category_id)` supporting `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

### Triggers, Stored Functions & Procedures
- `trg_validate_device_lifecycle_transition` (`BEFORE INSERT OR UPDATE ON devices`) — Enforces `lifecycle_transition_rules` and checks prerequisite rows in `inspections`, `repair_records`, `dismantling_records`, `material_recovery_records`, and `disposal_records`.
- `trg_append_device_lifecycle_event` (`AFTER INSERT OR UPDATE OF current_status ON devices`) — Atomically appends transitions to `lifecycle_events`.
- `trg_protect_immutable_lifecycle_events` (`BEFORE UPDATE OR DELETE ON lifecycle_events`) — Raises `P0002` preventing any tampering with historical events.
- `trg_validate_hazardous_disposal_facility` (`BEFORE INSERT OR UPDATE ON disposal_records`) — Raises `P0003` if target facility lacks `authorized_for_hazardous = TRUE` or has an expired license.
- `trg_validate_recovered_component_lineage` & `trg_sync_dismantling_component_count` — Enforces matching `source_device_id` and maintains `total_components_extracted`.
- `trg_audit_devices / repairs / dismantling / disposal` — Captures `to_jsonb(OLD)` and `to_jsonb(NEW)` snapshots into `audit_logs`.
- `fn_get_allowed_next_statuses(p_device_id)` — Returns reachable next states and prerequisite readiness.
- `fn_calculate_device_recovery_metrics(p_device_id)` — Computes circular mass-balance %, economic recovery, and CO₂ offset.
- `sp_transfer_device_between_centers(...)` & `sp_refresh_analytics_views()` — Stored procedures for chain-of-custody transfers and concurrent materialized view refresh.
