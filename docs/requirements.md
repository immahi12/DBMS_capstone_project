# ReLoop — E-Waste Lifecycle & Recycling Tracker
## Phase 1: Requirement Analysis & Academic System Specification

---

## 1. Abstract

Rapid technological obsolescence has made electronic waste (e-waste) the fastest-growing hazardous solid waste stream globally. Traditional e-waste tracking relies on disconnected spreadsheets or coarse weight-only gate passes that lose asset visibility the moment a discarded device is dismantled. **ReLoop** is a SQL-intensive relational Database Management System (DBMS) platform built on **PostgreSQL 17**, **Node.js/Express (CommonJS)**, and **Vanilla JavaScript** that enforces end-to-end provenance from initial collection through diagnostic inspection, bench refurbishment, component-level harvesting, smelter material recovery, and regulated Treatment, Storage, and Disposal Facility (TSDF) containment. By combining third-normal-form (3NF) relational modeling, trigger-enforced finite state machines, append-only lifecycle ledgers, ACID transactions with `SAVEPOINT` controls, and `WITH RECURSIVE` lineage queries, ReLoop guarantees permanent component-level traceability even after physical dismantling.

---

## 2. Problem Statement

Organizations, universities, municipalities, and recyclers struggle to answer critical compliance and circular-economy questions:
1. What happened to each individual laptop, server, smartphone, or UPS collected during an e-waste drive?
2. Which functional components (RAM, NVMe SSDs, OLED screens, PSUs) were harvested from non-repairable devices, and which refurbished devices received them?
3. Were hazardous fractions (swollen lithium-ion batteries, leaded CRT glass, mercury backlights, sulfated lead-acid cells) legitimately treated at CPCB/SPCB-authorized TSDF plants with verifiable manifest numbers?
4. How can recycling KPIs be calculated accurately without double-counting a dismantled parent device and its extracted sub-components?

---

## 3. Objectives

1. Design a **3NF-normalized PostgreSQL relational schema** (~21 tables) modeling intake batches, devices, inspections, repairs, dismantling, components, raw materials, facilities, hazardous disposals, transfers, and JSONB audit logs.
2. Enforce **strict lifecycle state transitions** at the database layer using data-driven rules (`lifecycle_transition_rules`) and `BEFORE UPDATE` PL/pgSQL triggers.
3. Preserve **component-level and sub-assembly traceability** across dismantled devices and cross-device circular repairs using foreign keys and recursive CTEs.
4. Demonstrate advanced DBMS capabilities—joins, correlated subqueries, window functions (`LAG`, `LEAD`, `RANK`, `DENSE_RANK`, `ROW_NUMBER`), views, materialized views, composite/partial indexes, `EXPLAIN ANALYZE`, and ACID transaction isolation.

---

## 4. Existing System Limitations vs. Proposed System

| Dimension | Existing Spreadsheet / Basic CRUD Systems | Proposed ReLoop PostgreSQL System |
| :--- | :--- | :--- |
| **Lifecycle Control** | Arbitrary status edits; history overwritten | Trigger-enforced 12-state machine + immutable `lifecycle_events` |
| **Post-Dismantling Visibility** | Parent-child link lost once device is torn down | 1:1 `dismantling_records` + recursive `recovered_components` lineage |
| **Hazardous Compliance** | Unchecked facility text fields | Trigger `trg_validate_hazardous_disposal_facility` verifies TSDF license |
| **Concurrency & Integrity** | Partial writes on crash; race conditions on spare parts | ACID transactions, `SELECT ... FOR UPDATE`, and `SAVEPOINT` |
| **Analytics** | Manual pivot tables prone to double-counting | Real-time SQL views & concurrent materialized views |

---

## 5. Stakeholders & Role-Based Access Control (RBAC)

1. **`ADMIN`**: System administrators and sustainability auditors overseeing centers, facilities, users, and cross-hub analytics.
2. **`COLLECTION_MANAGER`**: Logistics staff registering collection batches, intake devices, and inter-center transfers.
3. **`INSPECTOR`**: Diagnostic engineers testing incoming devices and classifying circular pathways (`DIRECT_REUSE`, `REPAIR`, `DISMANTLE`, `RECYCLE`, `HAZARDOUS_DISPOSAL`).
4. **`REPAIR_OPERATOR`**: Refurbishment technicians diagnosing faults, installing harvested circular spare parts, running QA, and certifying devices for reuse.
5. **`RECYCLING_MANAGER`**: Dismantling and downstream compliance officers managing component extraction, smelter material recovery lots, and TSDF hazardous manifests.

---

## 6. Functional Requirements

- **FR-01 (Collection & Registration)**: Associate collected e-waste devices with `collection_batches`, `organizations`, `collection_centers`, and hierarchical `e_waste_categories`, generating unique tracking IDs (`RLP-YYYY-NNNNN`) and UUIDs.
- **FR-02 (Diagnostic Inspection)**: Record physical/functional status, battery health, hazard flags, and 1:N subsystem check results (`inspection_check_results`).
- **FR-03 (Lifecycle State Guard)**: Reject illegal status jumps and require verifiable prerequisite records before entering `REPAIRABLE`, `REFURBISHED`, `DISMANTLED`, `RECYCLED`, or `DISPOSED`.
- **FR-04 (Bench Repair & Circular Parts)**: Track repair costs, QA verification, reuse channels, and cross-device installation of harvested `recovered_components`.
- **FR-05 (Dismantling & Component Harvesting)**: Atomically record dismantling metadata and N extracted components (including nested sub-components) with individual conditions and destinations.
- **FR-06 (Material Recovery & Recycling)**: Track recovered raw material weights (`kg`), purity grades, CO₂ savings, and licensed facility routing (`facility_accepted_materials`).
- **FR-07 (Hazardous Disposal)**: Record Form-10 manifests, treatment methods, weights, and compliance certificates exclusively at authorized TSDF facilities.
- **FR-08 (Complete Traceability & Analytics)**: Provide chronological timelines with stage dwell hours and real-time executive KPIs.

---

## 7. Non-Functional Requirements

- **NFR-01 (Data Integrity)**: 100% relational integrity via PK, FK, `UNIQUE`, `NOT NULL`, `CHECK`, and PL/pgSQL triggers—never relying solely on frontend or application checks.
- **NFR-02 (Security)**: `bcryptjs` salted password hashing, signed JWT authentication, RBAC middleware, `audit_logs` tracking, and 100% parameterized SQL queries (`$1, $2, ...`) preventing SQL injection.
- **NFR-03 (Performance)**: Connection pooling (`pg.Pool`), composite indexes, partial indexes on active operational subsets, and `mv_monthly_ewaste_summary` materialized rollups.
- **NFR-04 (Transactional Atomicity)**: Multi-table mutations execute inside `BEGIN ... COMMIT / ROLLBACK` blocks so partial failures leave zero orphan records.

---

## 8. Hardware & Software Requirements

- **Database Engine**: PostgreSQL 15+ / 17.x (`psql`, `pgcrypto`)
- **Backend Runtime**: Node.js v20+ (CommonJS), Express.js 4.x, `pg` 8.x driver (No ORM)
- **Frontend**: HTML5, CSS3, Vanilla ES6+ JavaScript, Chart.js 4.x
- **Hardware Minimum**: Dual-core 2.0 GHz CPU, 4 GB RAM, 2 GB SSD storage
