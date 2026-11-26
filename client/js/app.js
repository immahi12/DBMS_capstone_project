/**
 * ReLoop Main Application Router & Session Shell
 * Handles all 14 required pages including Login, Dashboard, Device Management,
 * Register Device, Device Details, Inspections, Repairs, Dismantling,
 * Component Tracking, Material Recovery, Recycling Facilities, Disposal,
 * Lifecycle Tracking, and Analytics & Reports.
 */
(function () {
  const { esc, toast } = window.ReLoopUI;

  const DEMO_ROLES = [
    { role: 'ADMIN', email: 'admin@reloop.io', label: 'Aarav Mehta · Full Platform Access' },
    { role: 'COLLECTION_MANAGER', email: 'collector@reloop.io', label: 'Priya Nair · Intake & Registration' },
    { role: 'INSPECTOR', email: 'inspector@reloop.io', label: 'Rohan Kulkarni · Diagnostic Bench' },
    { role: 'REPAIR_OPERATOR', email: 'repair@reloop.io', label: 'Sneha Iyer · Refurbishment Lab' },
    { role: 'RECYCLING_MANAGER', email: 'recycling@reloop.io', label: 'Kabir Verma · Dismantling & TSDF' },
  ];

  function renderLoginView() {
    const root = document.getElementById('app-root');
    root.innerHTML = `
      <div class="login-screen">
        <div class="login-hero">
          <div>
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;">
              <img src="/assets/logo.svg" alt="ReLoop" style="width:46px;height:46px;" />
              <div>
                <div style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">ReLoop</div>
                <div style="color:#6ee7b7;font-size:12.5px;font-weight:600;">E-Waste Lifecycle & Component Traceability Platform</div>
              </div>
            </div>
            <h1 style="font-size:34px;line-height:1.2;margin:0 0 16px;max-width:520px;">
              End-to-End Relational Traceability for the Circular Electronics Economy.
            </h1>
            <p style="color:#d1fae5;font-size:15px;max-width:500px;line-height:1.6;">
              Track discarded electronics from corporate & civic intake through diagnostic inspection, bench refurbishment, component-level harvesting, smelter material recovery, and authorized TSDF hazardous containment.
            </p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;border-top:1px solid rgba(255,255,255,0.15);padding-top:22px;">
            <div>
              <div style="font-size:22px;font-weight:800;color:#34d399;">21 Tables</div>
              <div style="font-size:12px;color:#a7f3d0;">3NF Normalized PostgreSQL 17</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:#34d399;">ACID + Triggers</div>
              <div style="font-size:12px;color:#a7f3d0;">Immutable Ledger & State Guard</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:#34d399;">Recursive CTE</div>
              <div style="font-size:12px;color:#a7f3d0;">Component-Level Lineage</div>
            </div>
          </div>
        </div>

        <div class="login-panel">
          <div class="login-box">
            <h2 style="margin:0 0 4px;font-size:22px;">Operator Sign In</h2>
            <p class="card-subtitle" style="margin-bottom:20px;">Authenticate with bcrypt-verified credentials & RBAC role permissions</p>

            <form id="login-form">
              <div class="form-group">
                <label>Operator Email</label>
                <input type="email" id="login-email" value="admin@reloop.io" required />
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" id="login-password" value="ReLoop@2026" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;margin-top:6px;">
                Sign In to ReLoop Console
              </button>
            </form>

            <div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border-light);">
              <div style="font-size:11.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">
                Quick DBMS Viva Role Switcher (Password: ReLoop@2026)
              </div>
              <div class="demo-role-grid">
                ${DEMO_ROLES.map(
                  (dr) => `
                  <button type="button" class="demo-role-btn" data-email="${esc(dr.email)}">
                    <div style="font-weight:700;color:var(--brand-900);">${esc(dr.role)}</div>
                    <div style="color:var(--text-muted);">${esc(dr.label)}</div>
                  </button>`
                ).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll('.demo-role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('login-email').value = btn.getAttribute('data-email');
        document.getElementById('login-password').value = 'ReLoop@2026';
      });
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await window.ReLoopAPI.post('/api/auth/login', {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        });
        window.ReLoopAPI.setSession(res.token, res.user);
        toast(`Authenticated as ${res.user.full_name} (${res.user.role})`);
        window.location.hash = '#/dashboard';
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function ensureShell(user) {
    const root = document.getElementById('app-root');
    if (document.getElementById('page-content')) return;

    root.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <img src="/assets/logo.svg" alt="ReLoop" />
            <div>
              <div class="brand-title">ReLoop</div>
              <div class="brand-subtitle">Circular E-Waste DBMS</div>
            </div>
          </div>

          <div class="nav-section-label">Overview & Intake</div>
          <ul class="nav-list">
            <li><a class="nav-link" data-route="dashboard" href="#/dashboard"><span class="nav-icon">📊</span> Dashboard</a></li>
            <li><a class="nav-link" data-route="devices" href="#/devices"><span class="nav-icon">💻</span> Device Management</a></li>
            <li><a class="nav-link" data-route="devices-new" href="#/devices/new"><span class="nav-icon">➕</span> Register Device</a></li>
          </ul>

          <div class="nav-section-label">Lifecycle Workflows</div>
          <ul class="nav-list">
            <li><a class="nav-link" data-route="inspections" href="#/inspections"><span class="nav-icon">🔬</span> Inspections</a></li>
            <li><a class="nav-link" data-route="repairs" href="#/repairs"><span class="nav-icon">🛠️</span> Repair & Refurbish</a></li>
            <li><a class="nav-link" data-route="dismantling" href="#/dismantling"><span class="nav-icon">⚙️</span> Dismantling Bay</a></li>
          </ul>

          <div class="nav-section-label">Circular Traceability</div>
          <ul class="nav-list">
            <li><a class="nav-link" data-route="components" href="#/components"><span class="nav-icon">🧩</span> Component Tracking</a></li>
            <li><a class="nav-link" data-route="materials" href="#/materials"><span class="nav-icon">♻️</span> Material Recovery</a></li>
            <li><a class="nav-link" data-route="facilities" href="#/facilities"><span class="nav-icon">🏭</span> Recycling Facilities</a></li>
            <li><a class="nav-link" data-route="disposal" href="#/disposal"><span class="nav-icon">☣️</span> Hazardous Disposal</a></li>
            <li><a class="nav-link" data-route="traceability" href="#/traceability"><span class="nav-icon">🔗</span> Lifecycle Tracking</a></li>
          </ul>

          <div class="nav-section-label">DBMS Intelligence</div>
          <ul class="nav-list">
            <li><a class="nav-link" data-route="analytics" href="#/analytics"><span class="nav-icon">📈</span> Analytics & SQL Viva</a></li>
          </ul>

          <div class="sidebar-footer">
            <div class="user-chip-name">${esc(user.full_name)}</div>
            <div class="user-chip-role">${esc(user.role)}</div>
            <div style="margin-top:10px;">
              <button class="btn btn-secondary btn-sm" id="btn-logout" style="width:100%;">Switch User / Sign Out</button>
            </div>
          </div>
        </aside>

        <div class="main-area">
          <header class="topbar">
            <div class="topbar-title-wrap">
              <h1 id="topbar-heading">Executive Dashboard</h1>
            </div>
            <form class="topbar-quick-trace" id="quick-trace-form">
              <input type="text" id="quick-trace-input" placeholder="Quick trace ID (e.g., RLP-2026-00002)..." />
              <button type="submit" class="btn btn-primary btn-sm">Trace</button>
            </form>
          </header>

          <main class="page-container" id="page-content"></main>
        </div>
      </div>
    `;

    document.getElementById('btn-logout').addEventListener('click', () => {
      window.ReLoopAPI.clearSession();
      window.location.hash = '#/login';
    });

    document.getElementById('quick-trace-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('quick-trace-input').value.trim();
      if (val) {
        window.location.hash = `#/traceability/${encodeURIComponent(val)}`;
      }
    });
  }

  async function router() {
    const hash = window.location.hash || '#/dashboard';
    const token = window.ReLoopAPI.getToken();
    const user = window.ReLoopAPI.getUser();

    if (hash === '#/login' || !token || !user) {
      renderLoginView();
      return;
    }

    ensureShell(user);
    const content = document.getElementById('page-content');
    const heading = document.getElementById('topbar-heading');

    const setActiveNav = (key, title) => {
      heading.textContent = title;
      document.querySelectorAll('.nav-link').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-route') === key);
      });
    };

    try {
      if (hash === '#/dashboard' || hash === '#/') {
        setActiveNav('dashboard', 'Circular Economy Executive Dashboard');
        await window.ReLoopPages.renderDashboard(content);
      } else if (hash === '#/devices/new') {
        setActiveNav('devices-new', 'Register New Electronic Waste Asset');
        await window.ReLoopPages.renderRegisterDevice(content);
      } else if (hash.startsWith('#/devices/')) {
        const id = decodeURIComponent(hash.replace('#/devices/', ''));
        setActiveNav('devices', `Device 360° Lifecycle Workbench — ${id}`);
        await window.ReLoopPages.renderDeviceDetails(content, id);
      } else if (hash === '#/devices') {
        setActiveNav('devices', 'Electronic Device Management');
        await window.ReLoopPages.renderDeviceList(content);
      } else if (hash === '#/inspections') {
        setActiveNav('inspections', 'Diagnostic Inspection Management');
        await window.ReLoopPages.renderInspections(content);
      } else if (hash === '#/repairs') {
        setActiveNav('repairs', 'Repair & Refurbishment Workbench');
        await window.ReLoopPages.renderRepairs(content);
      } else if (hash === '#/dismantling') {
        setActiveNav('dismantling', 'Dismantling & Component Harvesting');
        await window.ReLoopPages.renderDismantling(content);
      } else if (hash === '#/components') {
        setActiveNav('components', 'Component-Level Traceability Registry');
        await window.ReLoopPages.renderComponents(content);
      } else if (hash === '#/materials') {
        setActiveNav('materials', 'Raw Material Recovery & Smelter Routing');
        await window.ReLoopPages.renderMaterials(content);
      } else if (hash === '#/facilities') {
        setActiveNav('facilities', 'Certified Recycling & TSDF Facilities');
        await window.ReLoopPages.renderFacilities(content);
      } else if (hash === '#/disposal') {
        setActiveNav('disposal', 'Authorized Hazardous Waste Disposal');
        await window.ReLoopPages.renderDisposal(content);
      } else if (hash.startsWith('#/traceability/')) {
        const id = decodeURIComponent(hash.replace('#/traceability/', ''));
        setActiveNav('traceability', `Chronological Lifecycle & Lineage — ${id}`);
        await window.ReLoopPages.renderTraceability(content, id);
      } else if (hash === '#/traceability') {
        setActiveNav('traceability', 'Chronological Lifecycle & Lineage Tracking');
        await window.ReLoopPages.renderTraceability(content, 'RLP-2026-00002');
      } else if (hash === '#/analytics') {
        setActiveNav('analytics', 'Analytics, Reports & 26-Query DBMS Viva Lab');
        await window.ReLoopPages.renderAnalyticsReports(content);
      } else {
        window.location.hash = '#/dashboard';
      }
    } catch (err) {
      content.innerHTML = `<div class="callout callout-error"><strong>Error:</strong> ${esc(err.message)}</div>`;
    }
  }

  window.addEventListener('hashchange', router);
  window.addEventListener('DOMContentLoaded', router);
})();
