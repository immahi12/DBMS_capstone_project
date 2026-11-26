# ReLoop — E-Waste Lifecycle & Component-Level Recycling Tracker

> **SQL-Intensive PostgreSQL DBMS Capstone Project**  
> **Stack**: PostgreSQL 17 · Node.js + Express (CommonJS) · Raw Parameterized SQL (`pg` Pool, Zero ORM) · HTML5 / CSS3 / Vanilla JS · Chart.js

---

## 1. Project Overview

**ReLoop** tracks discarded electronic devices from initial corporate, campus, or civic collection all the way to circular reuse, component-level harvesting, raw material recovery, or authorized hazardous waste disposal (TSDF).

### Core Differentiator: Component-Level & Cross-Device Traceability
Even after an electronic device is structurally dismantled, ReLoop permanently preserves the relational lineage between:
1. **Donor Organization & Collection Batch** (`organizations` → `collection_batches`)
2. **Original Electronic Asset** (`devices`)
3. **1:1 Dismantling Operation** (`dismantling_records`)
4. **Harvested Components & Multi-Level Sub-Assemblies** (`recovered_components` self-referencing hierarchy)
5. **Downstream Circular Destination**:
   - Installed into another refurbished device (`recovered_components.installed_in_repair_id` → `repair_records` → target `devices`), OR
   - Smelted into raw metal/polymer lots (`material_recovery_records` → `recycling_facilities`), OR
   - Encapsulated/neutralized under regulated Form-10 manifests (`disposal_records` → TSDF `recycling_facilities`).

---

## 2. Database Engineering Highlights

- **21 Domain Tables in 3NF**: Includes 1:1 (`devices ↔ dismantling_records`), 1:N (`inspections ↔ inspection_check_results`), M:N (`component_material_composition`, `facility_accepted_materials`), and 2 self-referencing hierarchies (`e_waste_categories`, `recovered_components`).
- **Database-Enforced Lifecycle State Machine**: `lifecycle_transition_rules` + `trg_validate_device_lifecycle_transition` block illegal status jumps and prevent marking a device `RECYCLED`, `DISMANTLED`, `REFURBISHED`, or `DISPOSED` without corresponding evidence records.
- **Append-Only Immutable History**: `trg_protect_immutable_lifecycle_events` blocks `UPDATE` and `DELETE` on `lifecycle_events`.
- **TSDF Hazardous Waste Guard**: `trg_validate_hazardous_disposal_facility` blocks hazardous disposal to non-TSDF or license-expired facilities.
- **26 Curated Viva SQL Queries**: Live interactive runner inside the web app (`#/analytics`) demonstrating `INNER`/`LEFT`/`RIGHT`/`FULL OUTER`/`SELF` joins, correlated subqueries, `EXISTS`/`NOT EXISTS`/`ALL`, `WITH RECURSIVE`, `LAG`/`LEAD`/`RANK`/`DENSE_RANK`/`ROW_NUMBER`, views, concurrent materialized views, stored functions, JSONB audit diffs, and `EXPLAIN (ANALYZE, BUFFERS)` execution plans.

---

## 3. Repository Architecture

```text
reloop/
├── client/
│   ├── assets/                 # Brand SVG + local Chart.js UMD bundle
│   ├── css/styles.css          # Environmental SaaS design system
│   ├── js/                     # API client, formatting/chart helpers, SPA router
│   ├── pages/                  # Modular Vanilla JS controllers for all 14 views
│   ├── index.html
│   └── login.html
├── server/
│   ├── src/
│   │   ├── config/             # Environment config & pg.Pool + ACID transaction helper
│   │   ├── middleware/         # JWT auth, RBAC guard, SQLSTATE error translator
│   │   ├── modules/            # auth, collections, devices, inspections, repairs,
│   │   │                       # dismantling, components, materials, recycling,
│   │   │                       # disposal, analytics
│   │   ├── database/
│   │   │   ├── migrations/     # 001..004 SQL DDL (tables, indexes, triggers, views)
│   │   │   ├── seeds/          # Realistic 75-device, 100-component seed generator
│   │   │   └── queries/        # 26 Viva SQL queries (.sql + catalog)
│   │   └── app.js
│   ├── tests/
│   │   └── run_all_tests.js    # 13 end-to-end DB constraint, trigger & rollback tests
│   └── server.js
├── docs/
│   ├── requirements.md
│   ├── er-diagram.md
│   ├── database-schema.md
│   ├── normalization.md
│   ├── business-rules.md
│   ├── sql-concepts.md
│   └── api-documentation.md
├── scripts/
│   └── bootstrap_postgres.sh
└── package.json
```

---

## 4. Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Apply PostgreSQL migrations & populate realistic circular-economy seed data
npm run db:reset

# 3. Run the 13-suite integration, trigger & transaction rollback test runner
npm test

# 4. Launch the ReLoop server (http://0.0.0.0:3000)
npm start
```

---

## 5. Demo Accounts (Password for all roles: `ReLoop@2026`)

| Role | Email | Primary Responsibilities |
| :--- | :--- | :--- |
| **`ADMIN`** | `admin@reloop.io` | Full cross-module access & analytics |
| **`COLLECTION_MANAGER`** | `collector@reloop.io` | Batch intake, device registration & hub transfers |
| **`INSPECTOR`** | `inspector@reloop.io` | Diagnostic bench checks & circular pathway routing |
| **`REPAIR_OPERATOR`** | `repair@reloop.io` | Refurbishment tickets, circular spare part installation & QA |
| **`RECYCLING_MANAGER`** | `recycling@reloop.io` | Dismantling, component harvesting, material recovery & TSDF manifests |

---

## 6. Flagship Viva Walkthrough Scenarios

Open **`#/traceability`** in the UI and inspect these seeded tracking numbers:
- **`RLP-2026-00001` (Dell Latitude 7420)**: Collected → Inspected → Repaired using circular 16GB DDR4 RAM (`CMP-2026-00001`) harvested from dismantled laptop `RLP-2026-00002` → `REFURBISHED` → `READY_FOR_REUSE` (granted to VidyaSetu NGO).
- **`RLP-2026-00002` (HP EliteBook 840 G6)**: Dismantled into 7 components including a 2-level sub-assembly tree (`Display Assembly → Backlight Sub-Unit + Aluminum Lid`), cross-device RAM reuse, TSDF battery neutralization, and refinery Al/Cu/Au recovery (`RECYCLED`).
- **`RLP-2026-00004` (APC Smart-UPS 1500VA)**: Acute leaking lead-acid hazard routed directly to Haryana Enviro TSDF with Form-10 compliance certificate (`DISPOSED`).
- **`RLP-2026-00005` (Lenovo ThinkCentre M920t)**: Transferred across hubs (`device_transfers`), attempted bench repair (`UNREPAIRABLE_ESCALATED`), escalated to dismantling, and recycled.
