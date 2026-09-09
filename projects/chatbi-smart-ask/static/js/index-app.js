      const { createApp, ref, computed, nextTick, onMounted, watch } = Vue;

      function apiFetch(path, options = {}) {
        return fetch(`api${path}`, {
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
      }

      async function apiStream(path, payload, onEvent) {
        const emitChunk = (chunk) => {
          if (!chunk || !chunk.trim()) return;
          let event = "message";
          const dataLines = [];
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          const dataText = dataLines.join("\n");
          let data = null;
          try { data = dataText ? JSON.parse(dataText) : null; } catch { data = dataText; }
          if (onEvent) onEvent(event, data);
        };

        const res = await fetch(`api${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(payload || {}),
        });
        if (!res.ok) {
          const text = await res.text();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch {}
          if (res.status === 401) {
            try { window.dispatchEvent(new CustomEvent("smartask-auth-required")); } catch {}
          }
          const msg = (json && (json.detail || json.message)) || text || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (!res.body) {
          throw new Error("浏览器不支持流式响应");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r/g, "");
          let idx = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf("\n\n");
            emitChunk(chunk);
          }
        }
        buffer += decoder.decode();
        emitChunk(buffer.replace(/\r/g, ""));
      }

      const BRAND_STORAGE_KEY = "smartask_brand_config_v1";
      const CHAT_STORAGE_KEY = "smartask_chat_state_v2";
      const DS_SELECTION_KEY = "smartask_selected_datasources_v1";

      function defaultBrandConfig() {
        return {
          productName: "智能问数",
          headerLogo: "BI",
          sideLogo: "粤消",
        };
      }

      function loadBrandConfig() {
        try {
          const raw = localStorage.getItem(BRAND_STORAGE_KEY);
          const data = raw ? JSON.parse(raw) : null;
          return { ...defaultBrandConfig(), ...(data || {}) };
        } catch {
          return defaultBrandConfig();
        }
      }

      function saveBrandConfig(config) {
        try {
          localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(config || {}));
        } catch {}
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

      function loadChatState() {
        try {
          const raw = localStorage.getItem(CHAT_STORAGE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      }

      function saveChatState(state) {
        try {
          localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state || {}));
        } catch {}
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

      const app = createApp({
        setup() {
          // ==============================
          // 首页状态区：用户、指标、数据源、问答消息
          // ==============================
          let msgSeq = 1;
          let convSeq = 1;
          const me = ref(null);
          const runtime = ref(null);
          const brand = ref(loadBrandConfig());
          const showBrandEditor = ref(false);
          const brandForm = ref({ ...brand.value });
          const showLogin = ref(false);
          const login = ref({ username: "", password: "" });
          const loginError = ref("");
          const busy = ref(false);
          const chatting = ref(false);
          const demoRunning = ref(false);

          const dataSources = ref([]);
          const selectedDataSources = ref(loadDatasourceSelection());
          const examples = ref([]);
          const metrics = ref(null);
          const metricsLoading = ref(false);

          const showAccountManager = ref(false);
          const users = ref([]);
          const userForm = ref({ username: "", password: "", role: "user" });
          const userFormLoading = ref(false);
          const showResetPassword = ref(false);
          const resetPassword = ref({ username: "", password: "" });

const showFeatureSettings = ref(false);
const featureTab = ref("chart");
const featureSaving = ref(false);
const customCharts = ref([]);
const customChartForm = ref({
  id: "",
  name: "",
  description: "",
  seriesType: "bar",
  xField: "",
  yField: "",
  optionJson: "{\n  \"color\": [\"#2563eb\", \"#10b981\", \"#f59e0b\"],\n  \"legend\": { \"top\": 28 }\n}",
});
const customChartSeriesOptions = [
  { label: "柱状", value: "bar" },
  { label: "折线", value: "line" },
  { label: "散点", value: "scatter" },
  { label: "饼图", value: "pie" },
];
const mailSettings = ref({
  enabled: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_password: "",
  from_addr: "",
  use_tls: true,
  use_ssl: false,
  default_recipients: [],
  subject_template: "智能问数结果：{question}",
  password_set: false,
});
const mailRecipientsText = ref("");
const showMailSend = ref(false);
const mailSend = ref({ resultId: "", recipientsText: "", subject: "", message: "" });

const reports = ref([]);
function defaultReportForm() {
  return {
    id: "",
    name: "",
    description: "",
    questionsText: "",
    datasource_ids: [],
    formats: ["pdf"],
    recipientsText: "",
    schedule: { enabled: false, type: "daily", time: "08:30", interval_minutes: 60 },
  };
}
const reportForm = ref(defaultReportForm());

          const showAddSource = ref(false);
          const showAddTable = ref(false);
          const addSourceLoading = ref(false);
          const addTableLoading = ref(false);
          const addSource = ref({
            id: "",
            name: "",
            description: "",
            db_type: "sqlite",
            connection_mode: "url",
            db_path: "",
            db_url: "",
            host: "",
            port: "",
            database: "",
            username: "",
            password: "",
            options: "",
            tablesText: "",
          });
          const addTable = ref({
            datasourceId: "",
            datasourceName: "",
            datasourceDescription: "",
            dbPath: "",
            tableName: "",
            columnsText: "id:TEXT\nname:TEXT\ncount:INTEGER",
            rowsText: "",
          });
          const showUploadTable = ref(false);
          const uploadTableLoading = ref(false);
          const uploadTable = ref({
            datasourceId: "",
            datasourceName: "",
            datasourceDescription: "",
            dbPath: "",
            tableName: "",
            sheetName: "",
            maxRows: 1000,
          });
          const uploadWorkbook = ref(null);
          const uploadSheetOptions = ref([]);
          const uploadRows = ref([]);
          const uploadColumns = ref([]);
          const uploadPreviewRows = ref([]);
          const uploadPreviewColumns = computed(() => {
            return (uploadColumns.value || []).map((c) => ({
              title: c.name,
              dataIndex: c.name,
              key: c.name,
            }));
          });
          const examplePreview = computed(() => (examples.value || []).slice(0, 6));
          const dataSourceOptions = computed(() =>
            (dataSources.value || []).map((ds) => ({ label: ds.name, value: ds.id }))
          );
          const selectedSourceCards = computed(() =>
            (dataSources.value || [])
              .filter((ds) => selectedDataSources.value.includes(ds.id))
              .map((ds) => {
                const tableCount = Array.isArray(ds.tables) ? ds.tables.length : 0;
                const rowCount = Number.isFinite(ds.row_count) ? ds.row_count : null;
                return {
                  ...ds,
                  db_type_label: String(ds.db_type || "sqlite").toUpperCase(),
                  count_label: rowCount === null ? "外部数据源" : `${formatNumber(rowCount)} 条数据`,
                  table_label: `${tableCount} 张表`,
                };
              })
          );
          const runtimeModeLabel = computed(() => {
            if (!runtime.value) return "引擎未知";
            if (runtime.value.mode !== "real_llm") return "Mock规则模式";
            if (runtime.value.provider === "agent_http") return "智能体模式";
            if (runtime.value.provider === "openai_compatible") return "模型直连模式";
            return "真实LLM模式";
          });
          const runtimeModeColor = computed(() => {
            if (!runtime.value) return "default";
            if (runtime.value.mode !== "real_llm") return "orange";
            if (runtime.value.provider === "agent_http") return "cyan";
            return "green";
          });
          const overviewStats = computed(() => {
            const m = metrics.value || {};
            if (!Object.keys(m).length) return [];
            return [
              {
                label: "今日未处理",
                value: formatNumber(m.alarm_unprocessed_today || 0),
                sub: `累计未处理 ${formatNumber(m.alarm_unprocessed || 0)} 条`,
                tag: "告警",
                tagColor: "orange",
              },
              {
                label: "近7日火警",
                value: formatNumber(m.alarm_7d || 0),
                sub: `总火警 ${formatNumber(m.alarm_total || 0)} 条`,
                tag: "趋势",
                tagColor: "blue",
              },
              {
                label: "人员 / 在库",
                value: `${formatNumber(m.personnel_total || 0)} / ${formatNumber(m.equipment_in_stock_qty || 0)}`,
                sub: `装备总量 ${formatNumber(m.equipment_total_qty || 0)}`,
                tag: "资源",
                tagColor: "green",
              },
              {
                label: "近30日检查",
                value: m.inspection_avg_score_30d == null ? "--" : `${m.inspection_avg_score_30d}`,
                sub: `${formatNumber(m.inspection_30d || 0)} 次检查 · ${formatNumber(m.inspection_issues_30d || 0)} 个问题`,
                tag: "质态",
                tagColor: "purple",
              },
            ];
          });

          const builtinChartTypeOptions = [
            { label: "自动", value: "auto" },
            { label: "折线", value: "line" },
            { label: "面积", value: "area" },
            { label: "柱状", value: "bar" },
            { label: "分组柱状", value: "bar_group" },
            { label: "堆叠柱状", value: "bar_stack" },
            { label: "横向条形", value: "bar_horizontal" },
            { label: "饼图", value: "pie" },
            { label: "散点", value: "scatter" },
            { label: "热力", value: "heatmap" },
          ];
          const chartTypeOptions = computed(() => [
            ...builtinChartTypeOptions,
            ...(customCharts.value || []).map((item) => ({ label: item.name, value: `custom:${item.id}` })),
          ]);
          const dbTypeOptions = [
            { label: "SQLite", value: "sqlite" },
            { label: "MySQL", value: "mysql" },
            { label: "PostgreSQL", value: "postgres" },
          ];

          // ==============================
          // 会话与消息区：会话列表、当前会话、消息追加与标题维护
          // ==============================
          function newMsgId() {
            msgSeq += 1;
            return `m_${Date.now()}_${msgSeq}_${Math.random().toString(16).slice(2)}`;
          }

          function formatNumber(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return "--";
            return new Intl.NumberFormat("zh-CN").format(num);
          }

          function defaultMessages() {
            return [
              { id: newMsgId(), role: "ai", content: "你好，我是智能问数助手。你可以直接用自然语言提问，例如：按月统计火警趋势。" },
            ];
          }

          function newConversationId() {
            convSeq += 1;
            return `c_${Date.now()}_${convSeq}_${Math.random().toString(16).slice(2)}`;
          }

          function defaultConversation() {
            return {
              id: newConversationId(),
              title: "新对话",
              messages: defaultMessages(),
              created_at: Date.now(),
              updated_at: Date.now(),
            };
          }

          const chatState = loadChatState();
          const conversations = ref(
            (chatState && Array.isArray(chatState.conversations) && chatState.conversations.length)
              ? chatState.conversations
              : [defaultConversation()]
          );
          const activeConversationId = ref(
            (chatState && chatState.activeConversationId) || conversations.value[0].id
          );
          const activeConversation = computed(() =>
            conversations.value.find((c) => c.id === activeConversationId.value) || conversations.value[0]
          );
          const messages = computed({
            get() {
              return activeConversation.value ? activeConversation.value.messages : [];
            },
            set(val) {
              if (activeConversation.value) activeConversation.value.messages = val;
            },
          });
          const conversationOptions = computed(() =>
            (conversations.value || []).map((c, idx) => ({
              label: c.title || `对话${idx + 1}`,
              value: c.id,
            }))
          );
          const input = ref("");
          const didAutoDemo = ref(false);

          function touchConversation(conv) {
            if (!conv) return;
            conv.updated_at = Date.now();
          }

          function ensureConversationTitle(question) {
            const conv = activeConversation.value;
            if (!conv) return;
            const title = (conv.title || "").trim();
            if (!title || title === "新对话") {
              conv.title = question.length > 16 ? question.slice(0, 16) + "…" : question;
            }
          }

          function pushMessage(msg) {
            const conv = activeConversation.value;
            if (!conv) return;
            conv.messages.push(msg);
            touchConversation(conv);
          }

          function clearConversation() {
            const conv = activeConversation.value;
            if (!conv) return;
            conv.messages = defaultMessages();
            input.value = "";
            chatting.value = false;
            didAutoDemo.value = true;
            disposeAllCharts();
            scrollBottom();
          }

          function newConversation() {
            const conv = defaultConversation();
            conversations.value.unshift(conv);
            activeConversationId.value = conv.id;
            scrollBottom();
          }

          const chatLog = ref(null);
          const chartEls = new Map();
          const charts = new Map();

          function resultCount(r) {
            if (!r) return 0;
            const c = r.count ?? (r.data ? r.data.length : 0);
            return Number.isFinite(c) ? c : (r.data ? r.data.length : 0);
          }

          function hasChart(r) {
            const t = r && r.chart && r.chart.type;
            return !!(t && t !== "table");
          }

          function pickDefaultView(r) {
            return hasChart(r) ? "图表" : "表格";
          }

          // ==============================
          // 结果处理区：摘要、列分析、图表兼容配置
          // ==============================
          function assistantSummary(r) {
            const cnt = resultCount(r);
            if (!cnt) return "没有查到符合条件的数据。你可以调整时间范围或单位范围再试试。";
            return `查询到 ${cnt} 条记录，已生成${hasChart(r) ? "表格与图表" : "表格"}，可在下方查看。`;
          }

          function analyzeColumns(rows) {
            if (!rows.length) return { cols: [], numericCols: [], textCols: [] };
            const cols = Object.keys(rows[0]);
            const numericCols = cols.filter((c) =>
              rows.some((r) => typeof r[c] === "number" && Number.isFinite(r[c]))
            );
            const textCols = cols.filter((c) => !numericCols.includes(c));
            return { cols, numericCols, textCols };
          }

          function buildChartConfig(type, rows, baseCfg) {
            if (!rows.length) return null;
            const { cols, numericCols, textCols } = analyzeColumns(rows);
            const title = (baseCfg && baseCfg.title) || "查询结果";
            const cfg = { type, title };

            if (type === "pie") {
              const nameField = (baseCfg && baseCfg.nameField) || textCols[0] || cols[0];
              const valueField = (baseCfg && baseCfg.valueField) || numericCols[0] || cols[1];
              if (!nameField || !valueField) return null;
              return { ...cfg, nameField, valueField };
            }

            if (type === "heatmap") {
              const xField = (baseCfg && baseCfg.xField) || cols[0];
              const yField = (baseCfg && baseCfg.yField) || cols[1];
              const valueField = (baseCfg && baseCfg.valueField) || numericCols[0] || cols[2];
              if (!xField || !yField || !valueField) return null;
              return { ...cfg, xField, yField, valueField };
            }

            if (type === "scatter") {
              const xField = (baseCfg && baseCfg.xField) || numericCols[0];
              const yField = (baseCfg && baseCfg.yField) || numericCols[1];
              if (!xField || !yField) return null;
              return { ...cfg, xField, yField };
            }

            if (type === "bar_group" || type === "bar_stack") {
              if (baseCfg && baseCfg.seriesField) {
                return { ...cfg, xField: baseCfg.xField, seriesField: baseCfg.seriesField, valueField: baseCfg.valueField };
              }
              if (baseCfg && Array.isArray(baseCfg.yFields) && baseCfg.yFields.length) {
                return { ...cfg, xField: baseCfg.xField, yFields: baseCfg.yFields };
              }
              if (textCols.length >= 2 && numericCols.length) {
                return { ...cfg, xField: textCols[0], seriesField: textCols[1], valueField: numericCols[0] };
              }
              if (textCols.length >= 1 && numericCols.length >= 2) {
                return { ...cfg, xField: textCols[0], yFields: numericCols.slice(0, 3) };
              }
              return null;
            }

            if (["line", "bar", "area", "bar_horizontal"].includes(type)) {
              const xField = (baseCfg && baseCfg.xField) || textCols[0] || cols[0];
              if (baseCfg && Array.isArray(baseCfg.yFields) && baseCfg.yFields.length) {
                return { ...cfg, xField, yFields: baseCfg.yFields };
              }
              if (numericCols.length >= 2 && (type === "line" || type === "area")) {
                return { ...cfg, xField, yFields: numericCols.slice(0, 3) };
              }
              const yField = (baseCfg && baseCfg.yField) || numericCols[0] || cols[1];
              if (!xField || !yField) return null;
              return { ...cfg, xField, yField };
            }

            return baseCfg || null;
          }



function deepMerge(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function buildCustomChartOption(template, rows, defaults) {
  const spec = (template && template.spec) || {};
  const { cols, numericCols, textCols } = analyzeColumns(rows);
  const xField = spec.xField || textCols[0] || cols[0];
  const yField = spec.yField || numericCols[0] || cols[1];
  const seriesType = spec.seriesType || "bar";
  const base = {
    title: { text: template.name || "自定义图表", left: "center", textStyle: { color: defaults.text, fontWeight: 900 } },
    tooltip: { trigger: seriesType === "pie" ? "item" : "axis" },
    grid: { left: 44, right: 22, top: 64, bottom: 44 },
    textStyle: { color: defaults.muted },
  };
  if (seriesType === "pie") {
    base.series = [{
      type: "pie",
      radius: "72%",
      label: { color: defaults.text },
      data: rows.map((r) => ({ name: r[xField], value: r[yField] })),
    }];
    base.grid = undefined;
  } else if (seriesType === "scatter") {
    base.tooltip = { trigger: "item" };
    base.xAxis = { type: "value", axisLabel: { color: defaults.muted }, splitLine: { lineStyle: { color: defaults.gridLine } } };
    base.yAxis = { type: "value", axisLabel: { color: defaults.muted }, splitLine: { lineStyle: { color: defaults.gridLine } } };
    base.series = [{ type: "scatter", data: rows.map((r) => [r[xField], r[yField]]) }];
  } else {
    base.xAxis = { type: "category", data: rows.map((r) => r[xField]), axisLabel: { color: defaults.muted }, axisLine: { lineStyle: { color: defaults.axisLine } } };
    base.yAxis = { type: "value", axisLabel: { color: defaults.muted }, axisLine: { lineStyle: { color: defaults.axisLine } }, splitLine: { lineStyle: { color: defaults.gridLine } } };
    base.series = [{ type: seriesType, smooth: seriesType === "line", data: rows.map((r) => r[yField]) }];
  }
  return deepMerge(base, spec.option || {});
}

          function resolveChartConfig(m) {
            if (!m || !m.result) return null;
            const baseCfg = m.result.chart || null;
            const rows = m.result.data || [];
            const target = (m.chartType || "auto").trim();
            if (!target || target === "auto") return baseCfg;
            if (target.startsWith("custom:")) {
              const id = target.slice(7);
              const item = (customCharts.value || []).find((x) => x.id === id);
              if (!item) return baseCfg;
              return { type: "custom", title: item.name, customTemplate: item };
            }
            return buildChartConfig(target, rows, baseCfg);
          }

          function displayChartType(m) {
            const cfg = resolveChartConfig(m);
            if (!cfg || !cfg.type || cfg.type === "table") return "";
            const labelMap = {
              line: "折线",
              area: "面积",
              bar: "柱状",
              bar_group: "分组柱状",
              bar_stack: "堆叠柱状",
              bar_horizontal: "横向条形",
              pie: "饼图",
              heatmap: "热力",
              scatter: "散点",
              custom: "自定义",
            };
            return labelMap[cfg.type] || cfg.type;
          }

          function hasRenderableChart(m) {
            const cfg = resolveChartConfig(m);
            return !!(cfg && cfg.type && cfg.type !== "table");
          }

          function sqlSourceLabel(result) {
            const source = result && result.meta && result.meta.sql_source;
            const labels = {
              llm: "SQL: LLM",
              agent: "SQL: 智能体",
              rule: "SQL: 规则",
              rule_fallback: "SQL: LLM回退",
              user_sql: "SQL: 手动",
              seed_sql: "SQL: 示例",
              drilldown: "SQL: 下钻",
              chat: "聊天模式",
            };
            return labels[source] || "";
          }

          function sqlSourceColor(result) {
            const source = result && result.meta && result.meta.sql_source;
            if (source === "llm") return "green";
            if (source === "agent") return "cyan";
            if (source === "rule_fallback") return "orange";
            if (source === "rule") return "gold";
            if (source === "user_sql") return "blue";
            if (source === "drilldown") return "cyan";
            return "default";
          }



function splitRecipients(text) {
  return String(text || "")
    .replaceAll(";", ",")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function resetCustomChartForm() {
  customChartForm.value = {
    id: "",
    name: "",
    description: "",
    seriesType: "bar",
    xField: "",
    yField: "",
    optionJson: "{\n  \"color\": [\"#2563eb\", \"#10b981\", \"#f59e0b\"],\n  \"legend\": { \"top\": 28 }\n}",
  };
}

function editCustomChart(item) {
  const spec = (item && item.spec) || {};
  customChartForm.value = {
    id: item.id || "",
    name: item.name || "",
    description: item.description || "",
    seriesType: spec.seriesType || "bar",
    xField: spec.xField || "",
    yField: spec.yField || "",
    optionJson: JSON.stringify(spec.option || {}, null, 2),
  };
}

async function refreshCustomCharts() {
  const res = await apiFetch("/custom-charts");
  customCharts.value = res.data || [];
}

async function saveCustomChart() {
  let option = {};
  try {
    option = JSON.parse(customChartForm.value.optionJson || "{}");
  } catch (e) {
    antd.message.error("ECharts option JSON 格式不正确");
    return;
  }
  featureSaving.value = true;
  try {
    await apiFetch("/custom-charts", {
      method: "POST",
      body: JSON.stringify({
        id: customChartForm.value.id || null,
        name: customChartForm.value.name,
        description: customChartForm.value.description,
        spec: {
          seriesType: customChartForm.value.seriesType,
          xField: customChartForm.value.xField,
          yField: customChartForm.value.yField,
          option,
        },
      }),
    });
    await refreshCustomCharts();
    resetCustomChartForm();
    antd.message.success("自定义图表模板已保存");
  } catch (e) {
    antd.message.error(e.message || "保存失败");
  } finally {
    featureSaving.value = false;
  }
}

async function deleteCustomChart(item) {
  if (!item || !item.id) return;
  featureSaving.value = true;
  try {
    await apiFetch(`/custom-charts/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await refreshCustomCharts();
    antd.message.success("已删除");
  } catch (e) {
    antd.message.error(e.message || "删除失败");
  } finally {
    featureSaving.value = false;
  }
}

async function refreshMailSettings() {
  const res = await apiFetch("/mail/settings");
  mailSettings.value = { ...mailSettings.value, ...(res.data || {}), smtp_password: "" };
  mailRecipientsText.value = (mailSettings.value.default_recipients || []).join("\n");
}

async function saveMailSettings() {
  featureSaving.value = true;
  try {
    const payload = { ...mailSettings.value, default_recipients: splitRecipients(mailRecipientsText.value) };
    const res = await apiFetch("/mail/settings", { method: "POST", body: JSON.stringify(payload) });
    mailSettings.value = { ...mailSettings.value, ...(res.data || {}), smtp_password: "" };
    antd.message.success("邮件配置已保存");
  } catch (e) {
    antd.message.error(e.message || "保存失败");
    throw e;
  } finally {
    featureSaving.value = false;
  }
}

async function sendTestMail() {
  featureSaving.value = true;
  try {
    await saveMailSettings();
    await apiFetch("/mail/test", {
      method: "POST",
      body: JSON.stringify({
        recipients: splitRecipients(mailRecipientsText.value),
        subject: "智能问数邮件通知测试",
        message: "这是一封 SMTP 配置测试邮件。",
      }),
    });
    antd.message.success("测试邮件已发送");
  } catch (e) {
    antd.message.error(e.message || "测试邮件失败");
  } finally {
    featureSaving.value = false;
  }
}

async function openFeatureSettings() {
  showFeatureSettings.value = true;
  featureTab.value = "chart";
  try {
    await Promise.all([refreshCustomCharts(), refreshMailSettings(), refreshReports()]);
  } catch (e) {
    antd.message.error(e.message || "配置加载失败");
  }
}

async function refreshReports() {
  const res = await apiFetch("/reports");
  reports.value = res.data || [];
}

function resetReportForm() {
  reportForm.value = defaultReportForm();
}

function editReport(item) {
  const s = item.schedule || {};
  reportForm.value = {
    id: item.id || "",
    name: item.name || "",
    description: item.description || "",
    questionsText: (item.questions || []).join("\n"),
    datasource_ids: [...(item.datasource_ids || [])],
    formats: (item.formats || ["pdf"]).slice(),
    recipientsText: (item.recipients || []).join("\n"),
    schedule: {
      enabled: !!s.enabled,
      type: s.type || "daily",
      time: s.time || "08:30",
      interval_minutes: s.interval_minutes || 60,
    },
  };
}

function reportScheduleText(item) {
  const s = item.schedule || {};
  const count = (item.questions || []).length;
  if (!s.enabled) return `${count} 个问题 · 未定时`;
  return s.type === "interval" ? `${count} 个问题 · 每 ${s.interval_minutes} 分钟发送` : `${count} 个问题 · 每天 ${s.time} 发送`;
}

async function saveReport() {
  const f = reportForm.value;
  const questions = String(f.questionsText || "").split("\n").map((q) => q.trim()).filter(Boolean);
  if (!questions.length) {
    antd.message.warning("请至少填写一个问题");
    return;
  }
  featureSaving.value = true;
  try {
    const payload = {
      id: f.id || undefined,
      name: f.name,
      description: f.description,
      questions,
      datasource_ids: f.datasource_ids,
      formats: f.formats && f.formats.length ? f.formats : ["pdf"],
      recipients: splitRecipients(f.recipientsText),
      schedule: { ...f.schedule },
    };
    const res = await apiFetch("/reports", { method: "POST", body: JSON.stringify(payload) });
    reportForm.value.id = (res.data && res.data.id) || f.id;
    await refreshReports();
    antd.message.success("报告已保存");
  } catch (e) {
    antd.message.error(e.message || "保存失败");
  } finally {
    featureSaving.value = false;
  }
}

async function deleteReport(item) {
  try {
    await apiFetch(`/reports/${item.id}`, { method: "DELETE" });
    await refreshReports();
    if (reportForm.value.id === item.id) resetReportForm();
    antd.message.success("报告已删除");
  } catch (e) {
    antd.message.error(e.message || "删除失败");
  }
}

async function downloadReport(item, fmt) {
  try {
    antd.message.loading({ content: "报告生成中…", key: "report-gen", duration: 0 });
    const res = await fetch(`api/reports/${item.id}/generate?fmt=${fmt}`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.name || "report"}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
    antd.message.success({ content: "报告已生成", key: "report-gen" });
    await refreshReports();
  } catch (e) {
    antd.message.error({ content: e.message || "报告生成失败", key: "report-gen" });
  }
}

async function sendReportNow(item) {
  try {
    antd.message.loading({ content: "报告生成并发送中…", key: "report-send", duration: 0 });
    await apiFetch(`/reports/${item.id}/send`, { method: "POST", body: JSON.stringify({ recipients: [] }) });
    antd.message.success({ content: "报告邮件已发送", key: "report-send" });
    await refreshReports();
  } catch (e) {
    antd.message.error({ content: e.message || "发送失败", key: "report-send" });
  }
}

function openMailSend(m) {
  const r = m && m.result;
  if (!r || !r.result_id) return;
  mailSend.value = {
    resultId: r.result_id,
    recipientsText: (mailSettings.value.default_recipients || []).join("\n"),
    subject: (mailSettings.value.subject_template || "智能问数结果：{question}").replace("{question}", r.question || "查询结果"),
    message: "",
  };
  showMailSend.value = true;
}

async function sendResultMail() {
  featureSaving.value = true;
  try {
    await apiFetch("/mail/send", {
      method: "POST",
      body: JSON.stringify({
        result_id: mailSend.value.resultId,
        recipients: splitRecipients(mailSend.value.recipientsText),
        subject: mailSend.value.subject,
        message: mailSend.value.message,
      }),
    });
    showMailSend.value = false;
    antd.message.success("邮件已发送");
  } catch (e) {
    antd.message.error(e.message || "邮件发送失败");
  } finally {
    featureSaving.value = false;
  }
}

          // ==============================
          // 数据源配置辅助区：表名、字段、连接串等输入解析与预处理
          // ==============================
          function parseTableList(text) {
            return String(text || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }

          function defaultPortByDbType(dbType) {
            if (dbType === "mysql") return "3306";
            if (dbType === "postgres") return "5432";
            return "";
          }

          function buildManualDbUrl(source) {
            const dbType = String((source && source.db_type) || "").trim().toLowerCase();
            if (!dbType || dbType === "sqlite") return "";
            const host = String((source && source.host) || "").trim();
            const port = String((source && source.port) || "").trim();
            const database = String((source && source.database) || "").trim();
            const username = String((source && source.username) || "").trim();
            const password = String((source && source.password) || "");
            const options = String((source && source.options) || "").trim().replace(/^\?+/, "");
            if (!host || !database || !username) return "";

            const scheme = dbType === "mysql" ? "mysql+pymysql" : "postgresql+psycopg";
            const auth = password
              ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
              : encodeURIComponent(username);
            const base = `${scheme}://${auth}@${host}${port ? `:${port}` : ""}/${encodeURIComponent(database)}`;
            return options ? `${base}?${options}` : base;
          }

          function manualDbUrlPreview() {
            return buildManualDbUrl(addSource.value);
          }

          function parseColumns(text) {
            const lines = String(text || "")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            return lines.map((line) => {
              const idx = line.indexOf(":");
              if (idx === -1) return { name: line, type: "TEXT" };
              return { name: line.slice(0, idx).trim(), type: line.slice(idx + 1).trim() || "TEXT" };
            });
          }

          // ==============================
          // 数据源维护动作区：新增数据源、快速建表、Excel 上传建表
          // ==============================
          async function submitAddSource() {
            // 新增数据源：读取表单输入并准备提交参数。
            if (addSourceLoading.value) return;
            const id = (addSource.value.id || "").trim();
            const name = (addSource.value.name || "").trim();
            const description = (addSource.value.description || "").trim();
            const dbType = String(addSource.value.db_type || "sqlite").trim().toLowerCase();
            const mode = String(addSource.value.connection_mode || "url").trim().toLowerCase();
            const dbPath = (addSource.value.db_path || "").trim();
            const dbUrl = dbType === "sqlite"
              ? ""
              : (mode === "manual" ? buildManualDbUrl(addSource.value) : (addSource.value.db_url || "").trim());
            const tables = parseTableList(addSource.value.tablesText);

            // 新增数据源：前端先做一层必要校验，尽早给用户反馈。
            if (!id) {
              antd.message.error("请填写数据源ID");
              return;
            }
            if (!tables.length) {
              antd.message.error("请至少填写一张表");
              return;
            }
            if (dbType !== "sqlite" && mode === "manual") {
              if (!(addSource.value.host || "").trim()) {
                antd.message.error("请填写数据库主机");
                return;
              }
              if (!(addSource.value.database || "").trim()) {
                antd.message.error("请填写数据库名");
                return;
              }
              if (!(addSource.value.username || "").trim()) {
                antd.message.error("请填写数据库用户名");
                return;
              }
              if (!(addSource.value.port || "").trim()) {
                addSource.value.port = defaultPortByDbType(dbType);
              }
            }
            if (dbType !== "sqlite" && !dbUrl) {
              antd.message.error("请填写数据库连接地址");
              return;
            }

            // 新增数据源：整理成后端接口需要的 payload。
            const payload = {
              id,
              name,
              description,
              db_type: dbType || "sqlite",
              tables,
            };
            if (dbType === "sqlite" && dbPath) payload.db_path = dbPath;
            if (dbType !== "sqlite") payload.db_url = dbUrl;

            // 新增数据源：提交后刷新数据源列表，并尽量保持当前选择。
            addSourceLoading.value = true;
            try {
              await apiFetch("/datasources", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("已新增数据源");
              showAddSource.value = false;
              addSource.value = {
                id: "",
                name: "",
                description: "",
                db_type: "sqlite",
                connection_mode: "url",
                db_path: "",
                db_url: "",
                host: "",
                port: "",
                database: "",
                username: "",
                password: "",
                options: "",
                tablesText: "",
              };
              if (!selectedDataSources.value.includes(id)) {
                selectedDataSources.value.push(id);
              }
              await refreshDataSources();
            } catch (e) {
              antd.message.error(e.message || "新增失败");
            } finally {
              addSourceLoading.value = false;
            }
          }

          async function submitAddTable() {
            // 快速建表：在 SQLite 数据源上直接创建演示表，适合现场快速补数据。
            if (addTableLoading.value) return;
            const id = (addTable.value.datasourceId || "").trim();
            const name = (addTable.value.datasourceName || "").trim();
            const description = (addTable.value.datasourceDescription || "").trim();
            const dbPath = (addTable.value.dbPath || "").trim();
            const tableName = (addTable.value.tableName || "").trim();
            const columns = parseColumns(addTable.value.columnsText || "");

            // 快速建表：校验数据源、表名和字段定义。
            if (!id) {
              antd.message.error("请填写数据源ID");
              return;
            }
            if (!tableName) {
              antd.message.error("请填写表名");
              return;
            }
            if (!columns.length) {
              antd.message.error("请填写字段定义");
              return;
            }

            // 快速建表：如果用户填写了示例数据，则解析 JSON 作为初始化数据。
            let rows = [];
            const rowsRaw = (addTable.value.rowsText || "").trim();
            if (rowsRaw) {
              try {
                rows = JSON.parse(rowsRaw);
                if (!Array.isArray(rows)) {
                  throw new Error("示例数据必须是数组");
                }
              } catch (e) {
                antd.message.error(e.message || "示例数据 JSON 格式错误");
                return;
              }
            }

            // 快速建表：通过 /datasources 接口一次完成数据源登记和建表。
            const payload = {
              id,
              name,
              description,
              tables: [tableName],
              create_table: { name: tableName, columns, rows },
            };
            if (dbPath) payload.db_path = dbPath;

            addTableLoading.value = true;
            try {
              await apiFetch("/datasources", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("已新增表格");
              showAddTable.value = false;
              addTable.value = {
                datasourceId: "",
                datasourceName: "",
                datasourceDescription: "",
                dbPath: "",
                tableName: "",
                columnsText: "id:TEXT\nname:TEXT\ncount:INTEGER",
                rowsText: "",
              };
              if (!selectedDataSources.value.includes(id)) {
                selectedDataSources.value.push(id);
              }
              await refreshDataSources();
            } catch (e) {
              antd.message.error(e.message || "新增失败");
            } finally {
              addTableLoading.value = false;
            }
          }

          // ==============================
          // 上传建表处理区：字段推断、值归一化、工作表解析与预览生成
          // ==============================
          function sanitizeIdentifier(name, fallback) {
            let cleaned = String(name || "").trim().replace(/[^A-Za-z0-9_]/g, "_");
            if (!cleaned) cleaned = fallback;
            if (/^[0-9]/.test(cleaned)) cleaned = `col_${cleaned}`;
            return cleaned;
          }

          function inferColumnType(values) {
            let hasFloat = false;
            let hasInt = false;
            let hasOther = false;
            for (const v of values) {
              if (v === null || v === undefined || v === "") continue;
              if (typeof v === "number") {
                if (Number.isInteger(v)) hasInt = true;
                else hasFloat = true;
                continue;
              }
              if (typeof v === "string") {
                const t = v.trim();
                if (!t) continue;
                if (/^-?\d+(\.\d+)?$/.test(t)) {
                  const num = Number(t);
                  if (Number.isInteger(num)) hasInt = true;
                  else hasFloat = true;
                } else {
                  hasOther = true;
                }
                continue;
              }
              hasOther = true;
            }
            if (hasOther) return "TEXT";
            if (hasFloat) return "REAL";
            if (hasInt) return "INTEGER";
            return "TEXT";
          }

          function normalizeValue(value, type) {
            if (value === null || value === undefined || value === "") return null;
            if (type === "INTEGER") {
              const v = typeof value === "number" ? value : Number(String(value).trim());
              return Number.isFinite(v) ? Math.trunc(v) : null;
            }
            if (type === "REAL") {
              const v = typeof value === "number" ? value : Number(String(value).trim());
              return Number.isFinite(v) ? v : null;
            }
            return value;
          }

          function buildUploadRows(rows, maxRows) {
            const sliced = rows.slice(0, maxRows);
            const rawCols = Object.keys(sliced[0] || {});
            const colMap = {};
            const used = new Set();
            rawCols.forEach((col, idx) => {
              let safe = sanitizeIdentifier(col, `col_${idx + 1}`);
              let base = safe;
              let i = 2;
              while (used.has(safe)) {
                safe = `${base}_${i}`;
                i += 1;
              }
              used.add(safe);
              colMap[col] = safe;
            });

            const normalizedRows = sliced.map((row) => {
              const out = {};
              for (const [orig, safe] of Object.entries(colMap)) {
                out[safe] = row[orig];
              }
              return out;
            });

            const columns = Object.values(colMap).map((name) => ({ name, type: "TEXT" }));
            for (const col of columns) {
              const values = normalizedRows.map((r) => r[col.name]);
              col.type = inferColumnType(values);
            }
            for (const row of normalizedRows) {
              for (const col of columns) {
                row[col.name] = normalizeValue(row[col.name], col.type);
              }
            }
            return { columns, rows: normalizedRows };
          }

          async function parseUploadSheet() {
            // Excel 上传：解析当前工作表，生成字段、数据和预览表格。
            const wb = uploadWorkbook.value;
            if (!wb) return;
            const sheetName = uploadTable.value.sheetName || wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            if (!ws) return;

            const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
            if (!rows.length) {
              uploadRows.value = [];
              uploadColumns.value = [];
              uploadPreviewRows.value = [];
              return;
            }

            const maxRows = Math.max(1, parseInt(uploadTable.value.maxRows || 1000, 10));
            const result = buildUploadRows(rows, maxRows);
            uploadRows.value = result.rows.map((r, idx) => ({ __idx: idx, ...r }));
            uploadColumns.value = result.columns;
            uploadPreviewRows.value = uploadRows.value.slice(0, 5);
          }

          async function handleUploadFileChange(event) {
            // Excel 上传：读取文件后生成工作表列表，并默认解析第一张表。
            const file = event && event.target && event.target.files ? event.target.files[0] : null;
            if (!file) return;
            try {
              const buf = await file.arrayBuffer();
              const wb = XLSX.read(buf, { type: "array" });
              uploadWorkbook.value = wb;
              uploadSheetOptions.value = (wb.SheetNames || []).map((n) => ({ label: n, value: n }));
              uploadTable.value.sheetName = (wb.SheetNames && wb.SheetNames[0]) || "";
              await parseUploadSheet();
            } catch (e) {
              antd.message.error(e.message || "读取文件失败");
            }
          }

          async function onUploadSheetChange() {
            await parseUploadSheet();
          }

          async function submitUploadTable() {
            // Excel 上传建表：把解析后的列和数据提交成一个新的 SQLite 表。
            if (uploadTableLoading.value) return;
            const id = (uploadTable.value.datasourceId || "").trim();
            const name = (uploadTable.value.datasourceName || "").trim();
            const description = (uploadTable.value.datasourceDescription || "").trim();
            const dbPath = (uploadTable.value.dbPath || "").trim();
            const tableName = (uploadTable.value.tableName || "").trim();

            if (!id) {
              antd.message.error("请填写数据源ID");
              return;
            }
            if (!tableName) {
              antd.message.error("请填写表名");
              return;
            }
            if (!uploadRows.value.length || !uploadColumns.value.length) {
              antd.message.error("请先选择文件并解析");
              return;
            }

            const payload = {
              id,
              name,
              description,
              tables: [tableName],
              create_table: {
                name: tableName,
                columns: uploadColumns.value,
                rows: uploadRows.value.map(({ __idx, ...rest }) => rest),
              },
            };
            if (dbPath) payload.db_path = dbPath;

            uploadTableLoading.value = true;
            try {
              await apiFetch("/datasources", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("表格已导入");
              showUploadTable.value = false;
              uploadTable.value = {
                datasourceId: "",
                datasourceName: "",
                datasourceDescription: "",
                dbPath: "",
                tableName: "",
                sheetName: "",
                maxRows: 1000,
              };
              uploadWorkbook.value = null;
              uploadSheetOptions.value = [];
              uploadRows.value = [];
              uploadColumns.value = [];
              uploadPreviewRows.value = [];
              if (!selectedDataSources.value.includes(id)) {
                selectedDataSources.value.push(id);
              }
              await refreshDataSources();
            } catch (e) {
              antd.message.error(e.message || "导入失败");
            } finally {
              uploadTableLoading.value = false;
            }
          }

          // ==============================
          // 结果表格与图表渲染区：表格列、图表实例、滚动与销毁管理
          // ==============================
          function tableDataFor(r) {
            const rows = (r && r.data) || [];
            return rows.map((row, i) => ({ __idx: i, ...row }));
          }

          function tableColumnsFor(r) {
            const rows = (r && r.data) || [];
            if (!rows.length) return [];
            return Object.keys(rows[0]).map((k) => ({ title: k, dataIndex: k, key: k }));
          }

          function scrollBottom() {
            nextTick(() => {
              if (!chatLog.value) return;
              chatLog.value.scrollTop = chatLog.value.scrollHeight;
            });
          }

          function disposeMsgChart(msgId) {
            const inst = charts.get(msgId);
            if (inst) {
              try { inst.dispose(); } catch {}
            }
            charts.delete(msgId);
            chartEls.delete(msgId);
          }

          function disposeAllCharts() {
            for (const id of Array.from(charts.keys())) disposeMsgChart(id);
            chartEls.clear();
          }

          function resetChat() {
            clearConversation();
          }

          // ==============================
          // 基础刷新与登录区：登录态、运行态、数据源、示例、指标刷新
          // ==============================
          async function refreshDataSources() {
            const res = await apiFetch("/datasources");
            dataSources.value = res.data || [];
            const preferred = selectedDataSources.value.length ? selectedDataSources.value : loadDatasourceSelection();
            const valid = preferred.filter((id) => dataSources.value.some((d) => d.id === id));
            selectedDataSources.value = valid.length ? valid : dataSources.value.map((d) => d.id);
          }

          async function refreshExamples() {
            const res = await apiFetch("/examples");
            examples.value = res.examples || [];
          }

          async function refreshMetrics() {
            if (!me.value) return;
            metricsLoading.value = true;
            try {
              const res = await apiFetch("/metrics");
              metrics.value = res.data || null;
            } catch (e) {
              metrics.value = null;
            } finally {
              metricsLoading.value = false;
            }
          }

          async function refreshMe() {
            try {
              const res = await apiFetch("/auth/me");
              me.value = res.user;
            } catch (e) {
              me.value = null;
            }
          }

          async function refreshRuntime() {
            if (!me.value) {
              runtime.value = null;
              return;
            }
            try {
              const res = await apiFetch("/runtime");
              runtime.value = res.data || null;
            } catch (e) {
              runtime.value = null;
            }
          }

          function fillDemoLogin() {
            login.value = { username: "admin", password: "admin123" };
            loginError.value = "";
          }

          async function doLogin() {
            busy.value = true;
            loginError.value = "";
            try {
              await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(login.value) });
              showLogin.value = false;
              await refreshMe();
              await Promise.all([refreshRuntime(), refreshDataSources(), refreshExamples(), refreshMetrics(), refreshCustomCharts()]);
              await runAutoDemo();
            } catch (e) {
              loginError.value = e.message || "登录失败";
            } finally {
              busy.value = false;
            }
          }

          async function logout() {
            await apiFetch("/auth/logout", { method: "POST" });
            me.value = null;
            runtime.value = null;
            metrics.value = null;
            showLogin.value = true;
          }

          function openDataSources() {
            window.location.href = "./datasources";
          }

          function openBrandEditor() {
            brandForm.value = { ...brand.value };
            showBrandEditor.value = true;
          }

          function saveBrand() {
            brand.value = { ...brandForm.value };
            saveBrandConfig(brand.value);
            applyBrandToShell(brand.value);
            showBrandEditor.value = false;
          }

          function resetBrand() {
            brandForm.value = { ...defaultBrandConfig() };
          }

          // ==============================
          // 账号管理区：用户列表、创建用户、删用户、重置密码
          // ==============================
          async function refreshUsers() {
            // 账号管理：拉取账号列表，供弹窗内展示和后续操作复用。
            const res = await apiFetch("/auth/users");
            users.value = res.data || [];
          }

          async function createUser() {
            // 账号管理：创建普通用户或管理员。
            if (userFormLoading.value) return;
            const username = (userForm.value.username || "").trim();
            const password = (userForm.value.password || "").trim();
            if (!username || !password) {
              antd.message.error("请填写用户名和密码");
              return;
            }
            userFormLoading.value = true;
            try {
              await apiFetch("/auth/users", { method: "POST", body: JSON.stringify(userForm.value) });
              userForm.value = { username: "", password: "", role: "user" };
              await refreshUsers();
              antd.message.success("账号已创建");
            } catch (e) {
              antd.message.error(e.message || "创建失败");
            } finally {
              userFormLoading.value = false;
            }
          }

          function openAccountManager() {
            // 账号管理：打开账号弹窗时立即拉一次最新列表。
            showAccountManager.value = true;
            refreshUsers().catch((e) => {
              antd.message.error(e.message || "加载账号失败");
            });
          }

          function confirmDeleteUser(user) {
            // 账号管理：删除前二次确认，避免误删。
            if (!user || !user.username) return;
            try {
              antd.Modal.confirm({
                title: "确认删除账号？",
                content: `将删除账号 ${user.username}，此操作不可恢复。`,
                okText: "删除",
                okType: "danger",
                cancelText: "取消",
                onOk: async () => {
                  try {
                    await apiFetch(`/auth/users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
                    await refreshUsers();
                    antd.message.success("账号已删除");
                  } catch (e) {
                    antd.message.error(e.message || "删除失败");
                  }
                },
              });
            } catch {}
          }

          function openResetPassword(user) {
            // 账号管理：打开重置密码弹窗，并预填目标用户名。
            if (!user || !user.username) return;
            resetPassword.value = { username: user.username, password: "" };
            showResetPassword.value = true;
          }

          async function submitResetPassword() {
            // 账号管理：更新指定用户密码，成功后回刷账号列表。
            const username = resetPassword.value.username;
            const password = (resetPassword.value.password || "").trim();
            if (!password) {
              antd.message.error("请输入新密码");
              return;
            }
            try {
              await apiFetch(`/auth/users/${encodeURIComponent(username)}`, {
                method: "PUT",
                body: JSON.stringify({ password }),
              });
              showResetPassword.value = false;
              resetPassword.value = { username: "", password: "" };
              await refreshUsers();
              antd.message.success("密码已更新");
            } catch (e) {
              antd.message.error(e.message || "更新失败");
            }
          }

          function fillExample(ex) {
            input.value = ex;
          }

          function createAiResultMessage(content, result) {
            return {
              id: newMsgId(),
              role: "ai",
              content,
              result,
              sqlDraft: (result && result.sql) || "",
              viewMode: pickDefaultView(result),
              chartType: "auto",
              expanded: true,
            };
          }

          function ensureResult(m) {
            if (!m) return null;
            if (!m.result) {
              m.result = {
                success: true,
                sql: "",
                sql_explain: "",
                data: [],
                analysis: "",
                chart: null,
                count: 0,
                truncated: false,
                max_rows: 0,
              };
              m.sqlDraft = "";
              m.viewMode = pickDefaultView(m.result);
              m.chartType = "auto";
              m.expanded = true;
            }
            return m.result;
          }

          function toggleExpand(m) {
            if (!m) return;
            m.expanded = !m.expanded;
          }

          function onMsgViewModeChange(m, v) {
            if (!m) return;
            if (typeof v === "string") m.viewMode = v;
            if (m.expanded) scheduleRenderMsgChart(m);
          }

          function onChartTypeChange(m, v) {
            if (!m) return;
            if (typeof v === "string") m.chartType = v;
            if (m.expanded) scheduleRenderMsgChart(m);
          }

          function setMsgChartEl(m, el) {
            if (!m || !m.id) return;
            const msgId = m.id;
            if (!el) {
              disposeMsgChart(msgId);
              return;
            }
            chartEls.set(msgId, el);
            if (m.expanded) scheduleRenderMsgChart(m);
          }

          function scheduleRenderMsgChart(m) {
            if (!m) return;
            nextTick(() => {
              renderMsgChart(m);
              setTimeout(() => {
                renderMsgChart(m);
                const inst = charts.get(m.id);
                if (inst) {
                  try { inst.resize(); } catch {}
                }
              }, 80);
            });
          }

          function renderMsgChart(m) {
            if (!m || !m.id || !m.result) return;
            if (!m.expanded) return;
            const msgId = m.id;
            const el = chartEls.get(msgId);
            if (!el) return;

            const earlyCfg = resolveChartConfig(m);
            if (!earlyCfg || earlyCfg.type === "table" || !m.result.data || !m.result.data.length) {
              const inst0 = charts.get(msgId);
              if (inst0) {
                try { inst0.clear(); } catch {}
              }
              return;
            }

            let inst = charts.get(msgId);
            if (!inst) {
              inst = echarts.init(el);
              charts.set(msgId, inst);
            }

            const r = m.result;
            const rows = (r && r.data) || [];
            const cfg = resolveChartConfig(m);
            const type = (cfg && cfg.type) || "table";

            if (!cfg || !rows.length || type === "table") {
              try { inst.clear(); } catch {}
              return;
            }

            const text = "#0f172a";
            const muted = "#475569";
            const gridLine = "rgba(15, 23, 42, 0.10)";
            const axisLine = "rgba(15, 23, 42, 0.22)";

            const option = {
              title: { text: cfg.title || "", left: "center", textStyle: { color: text, fontWeight: 900 } },
              tooltip: {},
              grid: { left: 44, right: 22, top: 64, bottom: 44 },
              textStyle: { color: muted },
            };

            if (type === "custom") {
              const customOption = buildCustomChartOption(cfg.customTemplate, rows, { text, muted, gridLine, axisLine });
              inst.setOption(customOption, true);
              try { inst.resize(); } catch {}
              inst.off("click");
              return;
            }

            if (["line", "bar", "area", "bar_group", "bar_stack", "bar_horizontal"].includes(type)) {
              const xField = cfg.xField;
              const yField = cfg.yField;
              const yFields = cfg.yFields;
              const seriesField = cfg.seriesField;
              const valueField = cfg.valueField || yField;
              const baseType = type === "area" ? "line" : "bar";
              const isLine = type === "line" || type === "area";
              const isHorizontal = type === "bar_horizontal";
              const stackKey = type === "bar_stack" ? "total" : undefined;

              let categories = rows.map((r) => r[xField]);
              let series = [];
              if (seriesField) {
                const seriesNames = Array.from(new Set(rows.map((r) => r[seriesField])));
                const categoryNames = Array.from(new Set(rows.map((r) => r[xField])));
                const lookup = new Map();
                for (const row of rows) {
                  lookup.set(`${row[seriesField]}||${row[xField]}`, row[valueField]);
                }
                categories = categoryNames;
                series = seriesNames.map((name) => ({
                  name,
                  type: isLine ? "line" : "bar",
                  stack: stackKey,
                  smooth: isLine,
                  areaStyle: type === "area" ? { opacity: 0.12 } : undefined,
                  data: categoryNames.map((cat) => lookup.get(`${name}||${cat}`) ?? 0),
                }));
              } else if (Array.isArray(yFields) && yFields.length) {
                series = yFields.map((field) => ({
                  name: field,
                  type: isLine ? "line" : "bar",
                  stack: stackKey,
                  smooth: isLine,
                  areaStyle: type === "area" ? { opacity: 0.12 } : undefined,
                  data: rows.map((r) => r[field]),
                }));
              } else {
                series = [{
                  type: isLine ? "line" : "bar",
                  data: rows.map((r) => r[valueField]),
                  smooth: isLine,
                  areaStyle: type === "area" ? { opacity: 0.12 } : undefined,
                }];
              }

              option.tooltip = { trigger: "axis" };
              if (isHorizontal) {
                option.xAxis = { type: "value", axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } }, splitLine: { lineStyle: { color: gridLine } } };
                option.yAxis = { type: "category", data: categories, axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } } };
              } else {
                option.xAxis = { type: "category", data: categories, axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } } };
                option.yAxis = { type: "value", axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } }, splitLine: { lineStyle: { color: gridLine } } };
              }
              option.series = series;
            } else if (type === "pie") {
              const nameField = cfg.nameField;
              const valueField = cfg.valueField;
              option.tooltip = { trigger: "item" };
              option.series = [{
                type: "pie",
                radius: "72%",
                label: { color: text },
                data: rows.map((r) => ({ name: r[nameField], value: r[valueField] })),
              }];
              option.grid = undefined;
            } else if (type === "heatmap") {
              const xField = cfg.xField;
              const yField = cfg.yField;
              const valueField = cfg.valueField;
              const xs = Array.from(new Set(rows.map((r) => r[xField])));
              const ys = Array.from(new Set(rows.map((r) => r[yField])));
              const data = rows.map((r) => [xs.indexOf(r[xField]), ys.indexOf(r[yField]), r[valueField]]);
              option.tooltip = { position: "top" };
              option.xAxis = { type: "category", data: xs, axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } } };
              option.yAxis = { type: "category", data: ys, axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } } };
              option.visualMap = { min: 0, max: Math.max(...rows.map((r) => r[valueField] || 0)), calculable: true, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: muted } };
              option.series = [{ type: "heatmap", data }];
              option.grid.bottom = 74;
            } else if (type === "scatter") {
              const xField = cfg.xField;
              const yField = cfg.yField;
              option.tooltip = { trigger: "item" };
              option.xAxis = { type: "value", axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } }, splitLine: { lineStyle: { color: gridLine } } };
              option.yAxis = { type: "value", axisLabel: { color: muted }, axisLine: { lineStyle: { color: axisLine } }, splitLine: { lineStyle: { color: gridLine } } };
              option.series = [{
                type: "scatter",
                data: rows.map((r) => [r[xField], r[yField]]),
              }];
            }

            inst.setOption(option, true);
            try { inst.resize(); } catch {}

            // 图表联动：点击下钻
            inst.off("click");
            inst.on("click", async (params) => {
              const r0 = m.result;
              const cfg0 = resolveChartConfig(m);
              if (busy.value || !r0 || !r0.result_id || !cfg0) return;

              let field = null;
              let value = null;
              if ((cfg0.type || "") === "pie") {
                field = cfg0.nameField;
                value = params && params.name;
              } else if (["line", "area", "bar", "bar_group", "bar_stack", "bar_horizontal"].includes(cfg0.type || "")) {
                field = cfg0.xField;
                value = params && params.name;
              } else {
                return;
              }
              if (!field || value === undefined || value === null) return;

              busy.value = true;
              try {
                const res = await apiFetch("/drilldown", {
                  method: "POST",
                  body: JSON.stringify({
                    result_id: r0.result_id,
                    field,
                    value: String(value),
                    datasource_ids: selectedDataSources.value,
                  }),
                });
                pushMessage(createAiResultMessage(`已联动下钻：${field} = ${value}`, res));
                scrollBottom();
              } catch (e) {
                antd.message.error(e.message || "下钻失败");
              } finally {
                busy.value = false;
              }
            });
          }

          async function ask(q) {
            const question = (q || "").trim();
            if (!question) return;

            pushMessage({ id: newMsgId(), role: "user", content: question });
            ensureConversationTitle(question);
            scrollBottom();

            busy.value = true;
            chatting.value = true;
            const history = messages.value
              .slice(-12)
              .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content }));
            const aiMsg = {
              id: newMsgId(),
              role: "ai",
              content: "",
              result: null,
              sqlDraft: "",
              viewMode: "表格",
              chartType: "auto",
              expanded: true,
            };
            pushMessage(aiMsg);
            scrollBottom();
            try {
              await apiStream(
                "/chat/stream",
                {
                  question,
                  datasource_ids: selectedDataSources.value,
                  history,
                },
                (event, data) => {
                  if (event === "chat") {
                    aiMsg.content = (data && data.reply) || "";
                  } else if (event === "sql_explain_delta") {
                    const r = ensureResult(aiMsg);
                    const delta = (data && data.delta) || "";
                    r.sql_explain = (r.sql_explain || "") + delta;
                  } else if (event === "analysis_delta") {
                    const r = ensureResult(aiMsg);
                    const delta = (data && data.delta) || "";
                    r.analysis = (r.analysis || "") + delta;
                  } else if (event === "sql_delta") {
                    const r = ensureResult(aiMsg);
                    const delta = (data && data.delta) || "";
                    r.sql = (r.sql || "") + delta;
                    aiMsg.sqlDraft = r.sql || aiMsg.sqlDraft;
                  } else if (event === "sql") {
                    const r = ensureResult(aiMsg);
                    r.sql = (data && data.sql) || "";
                    aiMsg.sqlDraft = r.sql || aiMsg.sqlDraft;
                  } else if (event === "sql_explain") {
                    const r = ensureResult(aiMsg);
                    r.sql_explain = (data && data.sql_explain) || "";
                  } else if (event === "analysis") {
                    const r = ensureResult(aiMsg);
                    r.analysis = (data && data.analysis) || "";
                  } else if (event === "result") {
                    const r = (data && data.result) || {};
                    if (aiMsg.result && aiMsg.result.sql_explain && !r.sql_explain) {
                      r.sql_explain = aiMsg.result.sql_explain;
                    }
                    if (aiMsg.result && aiMsg.result.analysis && !r.analysis) {
                      r.analysis = aiMsg.result.analysis;
                    }
                    aiMsg.result = r;
                    aiMsg.sqlDraft = r.sql || aiMsg.sqlDraft;
                    aiMsg.viewMode = pickDefaultView(r);
                    if (aiMsg.expanded) scheduleRenderMsgChart(aiMsg);
                  } else if (event === "error") {
                    const msg = (data && data.error) || "查询失败";
                    aiMsg.content = `查询失败：${msg}`;
                  } else if (event === "done") {
                    chatting.value = false;
                    busy.value = false;
                  }
                  scrollBottom();
                }
              );
            } catch (e) {
              aiMsg.content = `查询失败：${e.message || e}`;
              scrollBottom();
            } finally {
              chatting.value = false;
              busy.value = false;
            }
          }

          // ==============================
          // 交互动作区：发送、一键问数、重置、SQL再执行、上屏、下钻
          // ==============================
          async function send() {
            const q = input.value.trim();
            if (!q) return;
            if (!me.value) {
              showLogin.value = true;
              return;
            }
            input.value = "";
            await ask(q);
          }

          async function runDemo() {
            if (demoRunning.value) return;
            if (!me.value) {
              showLogin.value = true;
              return;
            }
            demoRunning.value = true;
            try {
              newConversation();
              if (activeConversation.value) activeConversation.value.title = "演示对话";
              await ask("查询最近7天的火警记录（含单位、地点、类型、处理状态）");
              await ask("按单位统计近7天火警数量");
              await ask("筛选今天未处理的火警明细");
              await ask("近7天火警处理状态占比");
              await ask("按月统计火警趋势");
              await ask("各站点人员数量与装备库存对比（多源联动）");
              try { antd.message.success("问数完成：SQL、表格与图表同屏展示，可导出或上屏"); } catch {}
            } finally {
              demoRunning.value = false;
            }
          }

          function confirmResetDb() {
            try {
              antd.Modal.confirm({
                title: "确认清空数据？",
                content: "将清空本地SQLite库（警情/人员/装备/监督检查），恢复为空表，不会重新生成演示数据。",
                okText: "清空",
                cancelText: "取消",
                onOk: resetDb,
              });
            } catch {
              resetDb();
            }
          }

          async function resetDb() {
            busy.value = true;
            try {
              await apiFetch("/demo/reset-db", { method: "POST" });
              antd.message.success("数据已重置");
              clearConversation();
              await refreshMe();
              await Promise.all([refreshDataSources(), refreshExamples(), refreshMetrics()]);
            } catch (e) {
              antd.message.error(e.message || "重置失败");
            } finally {
              busy.value = false;
            }
          }

          async function runAutoDemo() {
            if (didAutoDemo.value) return;
            if (!me.value) return;
            if (messages.value.some((m) => !!m.result)) return;
            didAutoDemo.value = true;

            input.value = "按月统计火警趋势";
            await send();
          }

          async function runSql(m) {
            if (!m || !m.sqlDraft || !m.sqlDraft.trim()) return;
            busy.value = true;
            try {
              const res = await apiFetch("/sql/run", {
                method: "POST",
                body: JSON.stringify({
                  sql: m.sqlDraft,
                  datasource_ids: selectedDataSources.value,
                  question: m.result ? m.result.question : null,
                }),
              });
              m.result = res;
              m.sqlDraft = res.sql || m.sqlDraft;
              m.viewMode = pickDefaultView(res);
              m.expanded = true;
              scheduleRenderMsgChart(m);
            } catch (e) {
              antd.message.error(e.message || "执行失败");
            } finally {
              busy.value = false;
            }
          }

          async function copySql(m) {
            const text = ((m && m.sqlDraft) || "").trim();
            if (!text) return;
            try {
              await navigator.clipboard.writeText(text);
              antd.message.success("SQL已复制");
            } catch (e) {
              try {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.setAttribute("readonly", "readonly");
                ta.style.position = "fixed";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                antd.message.success("SQL已复制");
              } catch (e2) {
                antd.message.error("复制失败，请手动复制");
              }
            }
          }

          async function pinToDashboard(m) {
            if (!m || !m.result || !m.result.result_id) return;
            try {
              const cfg = resolveChartConfig(m);
              const payload = { result_id: m.result.result_id };
              if (cfg && cfg.type && cfg.type !== "table") payload.chart = cfg;
              await apiFetch("/charts/pin", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("已上屏（打开图表大屏查看）");
            } catch (e) {
              antd.message.error(e.message || "上屏失败");
            }
          }

          // ==============================
          // 导出与打印区：Excel 导出、浏览器打印 PDF、HTML 转义
          // ==============================
          function exportExcel(m) {
            const r = m && m.result;
            if (!r || !r.data || !r.data.length) return;
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(r.data);
            XLSX.utils.book_append_sheet(wb, ws, "data");
            const fname = `智能问数_${new Date().toISOString().slice(0,10)}.xlsx`;
            XLSX.writeFile(wb, fname);
          }



function exportCsv(m) {
  const r = m && m.result;
  if (!r || !r.data || !r.data.length) return;
  const cols = Object.keys(r.data[0]);
  const escapeCsv = (v) => {
    const s = String(v ?? "");
    if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [
    cols.map(escapeCsv).join(","),
    ...r.data.map(row => cols.map(c => escapeCsv(row[c])).join(",")),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `智能问数_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

          function exportPdf(m) {
            // 走浏览器打印为PDF（无需额外依赖）
            const r = m && m.result;
            if (!r) return;
            const html = `
              <html><head><meta charset="utf-8"><title>导出PDF</title></head>
              <body style="font-family: Arial, 'PingFang SC', 'Microsoft YaHei';">
                <h2>智能问数导出</h2>
                <p><b>问题：</b>${(r.question || "").replaceAll("<","&lt;")}</p>
                <pre style="background:#f3f4f6; padding:10px; border-radius:8px;">${(r.sql || "").replaceAll("<","&lt;")}</pre>
                <h3>思考过程</h3>
                <pre>${(r.analysis || "").replaceAll("<","&lt;")}</pre>
                <h3>数据（前50行）</h3>
                ${renderTableHtml((r.data || []).slice(0,50))}
              </body></html>`;
            const w = window.open("", "_blank");
            if (!w) return;
            w.document.open();
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => {
              try { w.print(); } catch {}
            }, 150);
          }

          function renderTableHtml(rows) {
            if (!rows.length) return "<div>无数据</div>";
            const cols = Object.keys(rows[0]);
            const th = cols.map(c=>`<th style="border:1px solid #ddd; padding:6px; background:#fafafa;">${escapeHtml(c)}</th>`).join("");
            const trs = rows.map(r=>`<tr>${cols.map(c=>`<td style="border:1px solid #ddd; padding:6px;">${escapeHtml(String(r[c] ?? ''))}</td>`).join("")}</tr>`).join("");
            return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-size:12px;">${th?`<thead><tr>${th}</tr></thead>`:""}<tbody>${trs}</tbody></table>`;
          }

          function escapeHtml(s) {
            return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
          }

          // ==============================
          // 生命周期与持久化区：本地会话持久化、监听器、挂载初始化
          // ==============================
          const persistChatState = () => {
            saveChatState({
              conversations: conversations.value,
              activeConversationId: activeConversationId.value,
            });
          };

          watch(conversations, () => {
            if (!activeConversation.value && conversations.value.length) {
              activeConversationId.value = conversations.value[0].id;
            }
            persistChatState();
          }, { deep: true });

          watch(activeConversationId, () => {
            persistChatState();
            disposeAllCharts();
            nextTick(() => {
              messages.value.forEach((m) => {
                if (m && m.result) scheduleRenderMsgChart(m);
              });
              scrollBottom();
            });
          }, { immediate: true });

          watch(selectedDataSources, (val) => {
            saveDatasourceSelection(val || []);
          }, { deep: true });

          onMounted(async () => {
            applyBrandToShell(brand.value);
            window.addEventListener("smartask-auth-required", () => {
              showLogin.value = true;
            });

            await refreshMe();
            if (me.value) {
              await Promise.all([refreshRuntime(), refreshDataSources(), refreshExamples(), refreshMetrics(), refreshCustomCharts()]);
              await runAutoDemo();
            } else {
              showLogin.value = true;
            }

            window.addEventListener("resize", () => {
              for (const inst of charts.values()) {
                try { inst.resize(); } catch {}
              }
            });
          });

          // ==============================
          // 模板暴露区：把 setup 内状态和方法暴露给 HTML 模板
          // ==============================
          return {
            me,
            runtime,
            runtimeModeLabel,
            runtimeModeColor,
            brand,
            showBrandEditor,
            brandForm,
            openBrandEditor,
            saveBrand,
            resetBrand,
            showAccountManager,
            users,
            userForm,
            userFormLoading,
            openAccountManager,
            createUser,
            confirmDeleteUser,
            openResetPassword,
            showResetPassword,
            resetPassword,
            submitResetPassword,
            showFeatureSettings,
            featureTab,
            featureSaving,
            openFeatureSettings,
            customCharts,
            customChartForm,
            customChartSeriesOptions,
            resetCustomChartForm,
            editCustomChart,
            saveCustomChart,
            deleteCustomChart,
            mailSettings,
            reports,
            reportForm,
            resetReportForm,
            editReport,
            saveReport,
            deleteReport,
            downloadReport,
            sendReportNow,
            reportScheduleText,
            mailRecipientsText,
            saveMailSettings,
            sendTestMail,
            showMailSend,
            mailSend,
            openMailSend,
            sendResultMail,
            showLogin,
            login,
            loginError,
            busy,
            chatting,
            confirmResetDb,
            dataSources,
            selectedDataSources,
            dataSourceOptions,
            examples,
            examplePreview,
            metrics,
            metricsLoading,
            overviewStats,
            selectedSourceCards,
            messages,
            activeConversationId,
            conversationOptions,
            newConversation,
            clearConversation,
            input,
            chatLog,
            resultCount,
            assistantSummary,
            tableColumnsFor,
            tableDataFor,
            hasChart,
            hasRenderableChart,
            displayChartType,
            sqlSourceLabel,
            sqlSourceColor,
            toggleExpand,
            onMsgViewModeChange,
            onChartTypeChange,
            setMsgChartEl,
            refreshDataSources,
            fillExample,
            resetChat,
            openDataSources,
            doLogin,
            fillDemoLogin,
            logout,
            send,
            runDemo,
            runSql,
            copySql,
            pinToDashboard,
            exportExcel,
            exportCsv,
            exportPdf,
            demoRunning,
            showAddSource,
            showAddTable,
            showUploadTable,
            addSource,
            addTable,
            addSourceLoading,
            addTableLoading,
            uploadTable,
            uploadTableLoading,
            uploadSheetOptions,
            uploadRows,
            uploadPreviewRows,
            uploadPreviewColumns,
            submitAddSource,
            manualDbUrlPreview,
            submitAddTable,
            handleUploadFileChange,
            onUploadSheetChange,
            submitUploadTable,
            chartTypeOptions,
            dbTypeOptions,
          };
        }
      });
      try {
        app.use(antd);
        app.mount("#app");
        const el = document.getElementById("app");
        if (el) el.removeAttribute("v-cloak");
      } catch (e) {
        try {
          const msg = (e && (e.message || e.toString())) || "未知错误";
          const loading = document.querySelector(".boot-loading");
          if (loading) loading.textContent = `加载失败：${msg}`;
        } catch {}
      }
