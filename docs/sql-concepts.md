# ReLoop — Advanced SQL Concepts, 26 Viva Queries, Optimization & Testing Report

---

## 1. Summary of DBMS Concepts Demonstrated

| Category | Specific PostgreSQL / SQL Features Implemented in ReLoop |
| :--- | :--- |
| **Joins** | `INNER JOIN` (6-table provenance), `LEFT JOIN` (idle center detection), `RIGHT JOIN` (unrecovered material catalog), `FULL OUTER JOIN` (donor vs recipient org reconciliation), `SELF JOIN` (category hierarchy) |
| **Aggregates** | `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`, `COUNT(*) FILTER (WHERE ...)`, `HAVING` |
| **Subqueries** | Scalar subqueries (`SELECT` & `WHERE`), Correlated subqueries, `EXISTS`, `NOT EXISTS`, `IN`, `ALL` |
| **CTEs & Recursion** | Multi-stage CTEs, `WITH RECURSIVE` on `e_waste_categories` (3-level taxonomy) AND `recovered_components` (multi-level component sub-assembly disassembly + cross-device reuse) |
| **Window Functions** | `LAG()`, `LEAD()`, `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `SUM() OVER (ORDER BY ...)`, `SUM() OVER ()`, `PARTITION BY` |
| **Database Objects** | 5 Relational Views, 1 Concurrent Materialized View (`mv_monthly_ewaste_summary`), 7 PL/pgSQL Triggers, 4 Stored Functions (`CROSS JOIN LATERAL`), 2 Stored Procedures |
| **Transactions** | `BEGIN ISOLATION LEVEL REPEATABLE READ`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, `BEGIN TRANSACTION READ ONLY`, `SELECT ... FOR UPDATE` row locking |
| **Indexing & Plans** | B-Tree FK indexes, Composite indexes (`(device_id, occurred_at, event_id)`), Partial indexes (`WHERE current_status = 'IN_INVENTORY' ...`), `EXPLAIN (ANALYZE, BUFFERS)` |

---

## 2. Complete 26 DBMS Viva Queries Guide

> Full executable SQL for all 26 queries is located in `server/src/database/queries/viva_25_queries.sql` and can be run live in the **Analytics & SQL Viva Lab** UI (`#/analytics`).

1. **Q01 — 6-Table `INNER JOIN` (Device Intake & Donor Provenance)**: Joins `devices`, `e_waste_categories`, `collection_batches`, `organizations`, `collection_centers`, and `users` to display corporate-donated e-waste provenance. *Expected Output*: 20 rows showing tracking ID, model, batch, corporate donor, hub, and registering staff.
2. **Q02 — `LEFT JOIN` (Collection Center Capacity & Idle Hub Detection)**: Left-joins `collection_centers` to `devices` so Pune Hinjewadi (`MAINTENANCE`, `0 kg`) appears alongside active centers. *Expected Output*: All 5 centers with load %.
3. **Q03 — `RIGHT JOIN` (Material Catalog Coverage)**: Right-joins `material_recovery_records` onto `materials` to identify regulated materials (`Mercury`, `Neodymium`, etc.) even when zero recovery shipments exist. *Expected Output*: All 10 master materials.
4. **Q04 — `FULL OUTER JOIN` (Circular Organization Matrix)**: Reconciles organizations donating e-waste (`donor_summary`) against organizations receiving refurbished grants (`recipient_summary`, e.g., VidyaSetu NGO). *Expected Output*: 7 partner organizations with supply vs grant counts.
5. **Q05 — `SELF JOIN` (Category Adjacency Mapping)**: Self-joins `e_waste_categories` (`child → parent → grandparent`) to flatten 3-tier e-waste taxonomy. *Expected Output*: 14 category rows with parent and root domain names.
6. **Q06 — Aggregate Statistical Profile (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `HAVING`)**: Summarizes device count, total mass, average mass, min/max/avg INR value per leaf category. *Expected Output*: 8 populated leaf categories ordered by total mass.
7. **Q07 — Scalar Subqueries**: Compares each device's `estimated_value_inr` against `(SELECT AVG(estimated_value_inr) FROM devices)` in both `SELECT` and `WHERE`. *Expected Output*: Top 15 high-value enterprise servers and laptops with exact positive delta from global mean.
8. **Q08 — Correlated Subquery**: Finds devices heavier than the average weight of devices in **their own** `category_id`. *Expected Output*: Above-average-weight models within each category.
9. **Q09 — `EXISTS` Semi-Join**: Lists dismantled devices that yielded at least one `WORKING` or `REPAIRABLE` component destined for `REUSE`/`RESALE`/`REPAIR`. *Expected Output*: Dismantled source devices contributing to circular reuse.
10. **Q10 — `NOT EXISTS` Compliance Anti-Join**: Audits hazardous devices (`contains_hazardous_materials = TRUE`) that do not yet have a `disposal_records` manifest. *Expected Output*: Active hazardous devices requiring downstream tracking.
11. **Q11 — `IN` & `> ALL` Subquery Operators**: Identifies precious-metal/battery facilities whose monthly capacity exceeds **all** polymer recyclers. *Expected Output*: Top high-capacity smelters/refineries.
12. **Q12 — `WITH RECURSIVE` #1 (Category Taxonomy Tree)**: Recursively traverses `e_waste_categories` from `parent_category_id IS NULL` roots down to depth-3 leaf categories, building `Root -> Mid -> Leaf` breadcrumbs. *Expected Output*: 14 hierarchical taxonomy rows.
13. **Q13 — `WITH RECURSIVE` #2 (Component Sub-Assembly & Cross-Device Reuse Lineage)**: Traverses `recovered_components` (`CMP-2026-00004` Display Assembly → `CMP-2026-00005` Backlight + `CMP-2026-00006` Aluminum Lid) and links `CMP-2026-00001` (harvested from `RLP-2026-00002`) directly to its installation in refurbished laptop `RLP-2026-00001`! *Expected Output*: Complete multi-level component disassembly & destination table.
14. **Q14 — Chained CTEs & `CASE` Yield Efficiency**: Computes theoretical recoverable mass via `component_material_composition` vs actual `material_recovery_records` mass per device. *Expected Output*: 15 recycled devices classified into yield bands.
15. **Q15 — Window Functions `LAG()` & `LEAD()`**: Calculates exact hours spent in each lifecycle stage per device (`occurred_at - LAG(occurred_at)`) and previews the subsequent stage (`LEAD(to_status)`). *Expected Output*: Step-by-step dwell-time rows for flagship devices.
16. **Q16 — Window Functions `RANK()`, `DENSE_RANK()` & `SUM() OVER ()`**: Ranks recycling facilities by recovered mass and computes percentage share of total recovered mass. *Expected Output*: Ranked leaderboard of all 6 facilities.
17. **Q17 — `ROW_NUMBER() OVER (PARTITION BY source_device_id)`**: Extracts the #1 highest-value harvested component from every dismantled device. *Expected Output*: Top 15 flagship harvested components (OLEDs, RAID cards, SSDs, RAM).
18. **Q18 — Cumulative Window `SUM() OVER (ORDER BY month)` & MoM `LAG()`**: Computes monthly collected weight, running YTD cumulative mass, and month-over-month growth delta across Jan–Nov 2026. *Expected Output*: 11 monthly trend rows.
19. **Q19 — Financial Refurbishment ROI (`CASE WHEN`)**: Evaluates `resale_value_inr - actual_cost_inr` and classifies ROI tiers across completed repairs. *Expected Output*: 14 completed repair tickets ordered by net circular value created.
20. **Q20 — Executive KPI View (`vw_kpi_executive_summary`)**: Demonstrates single-query executive KPI retrieval using `FILTER (WHERE ...)` without double-counting. *Expected Output*: 1 summary row with all core platform KPIs.
21. **Q21 — Concurrent Materialized View (`mv_monthly_ewaste_summary`)**: Reads pre-aggregated monthly category rollups. *Expected Output*: 20 monthly-category rollup rows.
22. **Q22 — Stored SQL Function (`CROSS JOIN LATERAL fn_calculate_device_recovery_metrics`)**: Computes component count, reusable mass, material mass, hazardous mass, % mass accounted, INR value, and CO₂ saved per device. *Expected Output*: Mass-balance rows for `RLP-2026-00002..00005`.
23. **Q23 — Stored PL/pgSQL State-Machine Function (`fn_get_allowed_next_statuses`)**: Dynamically lists allowed next transitions and blocking prerequisite reasons for active devices. *Expected Output*: 20 state-readiness rows.
24. **Q24 — `JSONB` Audit Log Diff Query (`->>` Operator)**: Extracts `old_payload ->> 'current_status'` vs `new_payload ->> 'current_status'` written automatically by `trg_audit_devices`. *Expected Output*: 15 row-level audit trail entries.
25. **Q25 — `EXPLAIN (ANALYZE, BUFFERS)` on Composite Index**: Demonstrates ordered index access on `lifecycle_events (device_id, occurred_at ASC, event_id ASC)` avoiding a sort pass.
26. **Q26 — `EXPLAIN (ANALYZE, BUFFERS)` on Partial Index**: Demonstrates selective lookup on `idx_components_reusable_stock_partial` targeting only `IN_INVENTORY` working/repairable spare parts.

---

## 3. Indexing, Query Optimization & Performance Trade-Offs

1. **Sequential Scan vs. Index Scan**:
   - On very small lookup tables (e.g., `materials` with 10 rows occupying a single 8 KB PostgreSQL heap page), the cost-based planner rightly prefers a `Seq Scan` because reading 1 heap page is cheaper than reading 1 B-tree index page + 1 heap page (2 random I/Os).
   - As `lifecycle_events`, `devices`, and `recovered_components` scale to tens of thousands of rows, `idx_lifecycle_events_device_occurred (device_id, occurred_at ASC, event_id ASC)` converts $O(N \log N)$ full-table scan + sort into an $O(\log N + k)$ ordered `Index Scan`.
2. **Partial Indexes**:
   - Over time, 90%+ of devices reach terminal states (`RECYCLED`, `READY_FOR_REUSE`, `DISPOSED`), and 90%+ of components leave inventory.
   - `idx_devices_active_pipeline_partial` (`WHERE current_status NOT IN ('READY_FOR_REUSE', 'RECYCLED', 'DISPOSED')`) and `idx_components_reusable_stock_partial` (`WHERE current_status = 'IN_INVENTORY' ...`) keep index size tiny in shared buffers while accelerating workbench queues!
3. **Trade-Offs**:
   - Every secondary index adds write amplification on `INSERT` and non-HOT `UPDATE`s. Therefore, ReLoop indexes high-selectivity foreign keys and operational predicates rather than blindly indexing low-cardinality boolean columns alone.

---

## 4. Transactions, Isolation & Concurrency

- **Dismantling (`dismantling.service.js`)**: Runs under `BEGIN ISOLATION LEVEL REPEATABLE READ` with `SELECT ... FOR UPDATE` on the parent `devices` row and `SAVEPOINT sp_harvest_components`, ensuring atomic insertion of `dismantling_records`, N `recovered_components`, and device status progression.
- **Spare Component Allocation (`repairs.service.js`)**: Locks the target `recovered_components` row with `SELECT ... WHERE recovered_component_id = $1 AND current_status = 'IN_INVENTORY' FOR UPDATE` so two concurrent repair technicians cannot allocate the same harvested RAM module to two different laptops.
- **Read-Only Viva Runner (`analytics.service.js`)**: Executes benchmark queries inside `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;` guaranteeing analytical safety.

---

## 5. Automated Testing Results (`npm test`)

All **13 automated integration & database constraint test suites** pass (`node server/tests/run_all_tests.js`):
- PostgreSQL 17 connectivity & health verification
- `bcryptjs` authentication across all 5 RBAC roles + invalid credential rejection
- RBAC authorization denial (`403 FORBIDDEN_ROLE`) + `RBAC_DENIED` database audit logging
- Device registration + `UNIQUE` tracking number enforcement (`23505 → 409`)
- Foreign key violation enforcement (`23503 → 400`)
- Invalid lifecycle jump & missing-evidence rejection (`P0001 → 400`)
- Immutable `lifecycle_events` `UPDATE`/`DELETE` protection (`P0002`)
- Inspection workflow (`SAVEPOINT`) + automatic status routing
- Repair & circular refurbishment workflow
- Multi-step dismantling transaction rollback test (zero orphan rows on mid-flight constraint failure)
- Dismantling + component lineage + material recovery + `RECYCLED` verification
- Hazardous TSDF authorization trigger (`P0003`) blocking non-TSDF facilities + certifying valid TSDF disposal
- Live execution of all 26 Viva SQL Queries

---

## 6. Conclusion & Future Scope

**Conclusion**: ReLoop demonstrates how rigorous relational modeling, declarative constraints, server-side PL/pgSQL triggers, ACID transactions, and recursive SQL queries solve real-world circular-economy traceability without resorting to over-engineered distributed ledgers.

**Future Scope**:
1. Barcode / QR label PDF generation for physical bin scanning at collection centers.
2. EPR (Extended Producer Responsibility) quarterly statutory report export for CPCB compliance.
3. Table partitioning (`PARTITION BY RANGE (occurred_at)`) on `lifecycle_events` and `audit_logs` for multi-million-device national deployments.
