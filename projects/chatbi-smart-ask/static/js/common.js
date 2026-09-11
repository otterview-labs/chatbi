// 四个页面（智能问数/数据源/数据开发/图表大屏）共享的工具函数。
// 以普通全局 <script> 加载，需放在各页面自身脚本之前。

const BRAND_STORAGE_KEY = "smartask_brand_config_v1";
const DS_SELECTION_KEY = "smartask_selected_datasources_v1";

function makeApiFetch(basePath) {
  return function apiFetch(path, options = {}) {
    return fetch(`${basePath}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    }).then(async (r) => {
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) {
        if (r.status === 401) {
          try { window.dispatchEvent(new CustomEvent("smartask-auth-required")); } catch {}
        }
        const msg = (json && (json.detail || json.message)) || text || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return json;
    });
  };
}

function loadBrandConfig(defaults) {
  try {
    const raw = localStorage.getItem(BRAND_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return { ...defaults, ...(data || {}) };
  } catch {
    return { ...defaults };
  }
}

function applyBrandToShell(config) {
  const mapping = {
    sideLogo: config && config.sideLogo,
  };
  Object.entries(mapping).forEach(([key, val]) => {
    if (!val) return;
    document.querySelectorAll(`[data-brand="${key}"]`).forEach((el) => {
      el.textContent = val;
    });
  });
}

function loadDatasourceSelection() {
  try {
    const raw = localStorage.getItem(DS_SELECTION_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveDatasourceSelection(ids) {
  try {
    localStorage.setItem(DS_SELECTION_KEY, JSON.stringify(ids || []));
  } catch {}
}
