/**
 * ReLoop Shared Formatting, Escaping, Toast & Status Badge Utilities
 */
window.ReLoopUI = (function () {
  function esc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(val, decimals = 0) {
    const n = Number(val || 0);
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function fmtINR(val) {
    const n = Number(val || 0);
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function fmtDate(val, withTime = false) {
    if (!val) return '—';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return esc(val);
    return withTime
      ? d.toLocaleString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : d.toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        });
  }

  const STATUS_COLOR_MAP = {
    REGISTERED: 'badge-slate',
    COLLECTED: 'badge-blue',
    UNDER_INSPECTION: 'badge-amber',
    REPAIRABLE: 'badge-blue',
    UNDER_REPAIR: 'badge-amber',
    REFURBISHED: 'badge-green',
    READY_FOR_REUSE: 'badge-green',
    UNDER_DISMANTLING: 'badge-purple',
    DISMANTLED: 'badge-purple',
    UNDER_RECYCLING: 'badge-blue',
    RECYCLED: 'badge-green',
    DISPOSED: 'badge-red',
    // Component & sub-entity statuses
    WORKING: 'badge-green',
    IN_INVENTORY: 'badge-blue',
    REUSED_IN_DEVICE: 'badge-green',
    SOLD_FOR_REUSE: 'badge-green',
    HAZARDOUS_DISPOSED: 'badge-red',
    HAZARDOUS_INTACT: 'badge-red',
    HAZARDOUS_LEAKING: 'badge-red',
    COMPLETED: 'badge-green',
    PROCESSED_VERIFIED: 'badge-green',
    IN_PROGRESS: 'badge-amber',
    UNREPAIRABLE_ESCALATED: 'badge-red',
  };

  function statusBadge(status) {
    if (!status) return '<span class="badge badge-slate">—</span>';
    const cls = STATUS_COLOR_MAP[status] || 'badge-slate';
    return `<span class="badge ${cls}">${esc(String(status).replace(/_/g, ' '))}</span>`;
  }

  function toast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => {
      item.remove();
    }, 4200);
  }

  const activeCharts = {};
  function renderChart(canvasId, config) {
    if (activeCharts[canvasId]) {
      activeCharts[canvasId].destroy();
      delete activeCharts[canvasId];
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    activeCharts[canvasId] = new Chart(canvas.getContext('2d'), config);
    return activeCharts[canvasId];
  }

  return {
    esc,
    fmtNum,
    fmtINR,
    fmtDate,
    statusBadge,
    toast,
    renderChart,
  };
})();
