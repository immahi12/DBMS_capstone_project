# ReLoop — REST API Documentation

Base URL: `/api`  
Authentication: `Authorization: Bearer <JWT_TOKEN>` (except `POST /api/auth/login` and `GET /api/health`)

---

## 1. Authentication & System Health

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Verifies Express server & live PostgreSQL 17 connection |
| `POST` | `/api/auth/login` | Public | Authenticates `{ email, password }`, logs `AUTH_LOGIN`, returns JWT + user profile |
| `GET` | `/api/auth/me` | Any Auth | Returns authenticated operator profile & assigned hub |
| `GET` | `/api/auth/users` | Any Auth | Lists active platform staff |

---

## 2. Collection Batches & Reference Metadata

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/collections/meta` | Any Auth | Returns centers, organizations, recursive category tree, batches, and facilities |
| `POST` | `/api/collections` | `ADMIN`, `COLLECTION_MANAGER` | Creates a new `collection_batches` intake manifest |

---

## 3. Electronic Devices & Lifecycle Traceability

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/devices` | Any Auth | Queries `vw_device_master_overview` (`?search=&status=&category_id=&center_id=&hazardous=`) |
| `POST` | `/api/devices` | `ADMIN`, `COLLECTION_MANAGER` | Registers new device (and optional batch) inside ACID transaction |
| `GET` | `/api/devices/:identifier` | Any Auth | Returns 360° device details by `device_id` or `tracking_number` |
| `GET` | `/api/devices/:identifier/traceability` | Any Auth | Returns chronological `LAG`/`LEAD` timeline, `WITH RECURSIVE` component lineage, recovery metrics & allowed next states |
| `PATCH` | `/api/devices/:identifier/status` | Role-checked | Transitions `current_status` (`{ to_status, notes }`) validated by DB trigger |
| `POST` | `/api/devices/:identifier/transfer` | `ADMIN`, `COLLECTION_MANAGER`, `RECYCLING_MANAGER` | Calls `CALL sp_transfer_device_between_centers(...)` |

---

## 4. Inspections, Repairs & Dismantling Workflows

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/inspections` | Any Auth | Lists inspection history + pending `COLLECTED`/`UNDER_INSPECTION` queue |
| `POST` | `/api/inspections` | `ADMIN`, `INSPECTOR` | Transactional insert into `inspections` + `inspection_check_results` (`SAVEPOINT`) + pathway transition |
| `GET` | `/api/repairs` | Any Auth | Lists repair tickets, queue, and `IN_INVENTORY` circular spare components |
| `POST` | `/api/repairs` | `ADMIN`, `REPAIR_OPERATOR` | Opens repair ticket, locks & allocates circular spare component if specified |
| `PATCH` | `/api/repairs/:repairId/resolve` | `ADMIN`, `REPAIR_OPERATOR` | Resolves repair (`COMPLETED` → `REFURBISHED`/`READY_FOR_REUSE` or `UNREPAIRABLE_ESCALATED` → `UNDER_DISMANTLING`) |
| `GET` | `/api/dismantling` | Any Auth | Lists dismantling operations, `UNDER_DISMANTLING` queue, and `component_catalog` |
| `POST` | `/api/dismantling` | `ADMIN`, `RECYCLING_MANAGER` | Atomic `REPEATABLE READ` teardown creating 1:1 `dismantling_records` + N `recovered_components` |

---

## 5. Component Lineage, Materials, Facilities, Disposal & Analytics

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/components` | Any Auth | Queries `vw_component_full_lineage` + destination aggregates |
| `GET` | `/api/components/:uid/lineage` | Any Auth | Executes `WITH RECURSIVE` ancestor + descendant sub-assembly tree |
| `PATCH` | `/api/components/:id/status` | `ADMIN`, `RECYCLING_MANAGER`, `REPAIR_OPERATOR` | Updates downstream component status/destination |
| `GET` | `/api/materials` | Any Auth | Lists material recovery lots, M:N licensed facilities, and yield summary |
| `POST` | `/api/materials/recover` | `ADMIN`, `RECYCLING_MANAGER` | Validates M:N license, records recovery lot, optionally marks device `RECYCLED` |
| `GET` | `/api/recycling/facilities` | Any Auth | Lists `vw_facility_performance_metrics` + accepted materials |
| `POST` | `/api/recycling/facilities` | `ADMIN`, `RECYCLING_MANAGER` | Registers certified recycling/TSDF facility + M:N accepted materials |
| `GET` | `/api/disposal` | Any Auth | Lists hazardous TSDF manifests & candidate devices |
| `POST` | `/api/disposal` | `ADMIN`, `RECYCLING_MANAGER` | Creates TSDF manifest (validated by `trg_validate_hazardous_disposal_facility`) |
| `GET` | `/api/analytics/dashboard` | Any Auth | Returns all 15 executive KPIs, monthly trends, category distribution, center & facility views |
| `GET` | `/api/analytics/reports` | Any Auth | Returns materialized view rows, dwell-time report, material value, and `audit_logs` |
| `GET` | `/api/analytics/viva-queries` | Any Auth | Lists all 26 curated DBMS Viva SQL queries |
| `POST` | `/api/analytics/viva-queries/:id/run` | Any Auth | Executes selected Viva query inside `BEGIN TRANSACTION READ ONLY` |
| `POST` | `/api/analytics/refresh-views` | `ADMIN`, `RECYCLING_MANAGER` | Calls `CALL sp_refresh_analytics_views()` |

---

## 6. Error Codes Mapped from PostgreSQL `SQLSTATE`

| PostgreSQL `SQLSTATE` | HTTP Status | API Error Code | Cause |
| :--- | :---: | :--- | :--- |
| `P0001` | `400` | `LIFECYCLE_RULE_VIOLATION` | Illegal state jump or missing inspection/repair/dismantling/recycling/disposal record |
| `P0002` | `403` | `IMMUTABLE_LEDGER_VIOLATION` | Attempted `UPDATE` or `DELETE` on `lifecycle_events` |
| `P0003` | `400` | `HAZARDOUS_COMPLIANCE_VIOLATION` | Target facility is not TSDF-authorized or license expired |
| `P0004` | `400` | `COMPONENT_LINEAGE_VIOLATION` | Component `source_device_id` mismatch with parent dismantling/device |
| `23505` | `409` | `DUPLICATE_RECORD` | Duplicate `tracking_number`, `serial_number`, `manifest_number`, etc. |
| `23503` | `400` | `FOREIGN_KEY_VIOLATION` | Referenced parent key does not exist or `ON DELETE RESTRICT` |
| `23514` | `400` | `CHECK_CONSTRAINT_VIOLATION` | Domain/range violation (e.g., `weight_kg <= 0`) |
