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

      const BRAND_STORAGE_KEY = "smartask_brand_config_v1";
      const DS_SELECTION_KEY = "smartask_selected_datasources_v1";

      function defaultBrandConfig() {
        return {
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

      const app = createApp({
        setup() {
          // ==============================
          // 数据源页状态区：数据源列表、筛选条件、指标、示例问法、表单态
          // ==============================
          const me = ref(null);
          const brand = ref(loadBrandConfig());
          const showLogin = ref(false);
          const login = ref({ username: "", password: "" });
          const loginError = ref("");
          const busy = ref(false);

          const dataSources = ref([]);
          const selectedDataSources = ref(loadDatasourceSelection());
          const sourceSearch = ref("");
          const examples = ref([]);
          const metrics = ref(null);
          const metricsLoading = ref(false);

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
          const dbTypeOptions = [
            { label: "SQLite", value: "sqlite" },
            { label: "MySQL", value: "mysql" },
            { label: "PostgreSQL", value: "postgres" },
            { label: "ClickHouse", value: "clickhouse" },
          ];
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
          // ==============================
          // 视图派生区：搜索过滤、已选数量、展示列表
          // ==============================
          const filteredDataSources = computed(() => {
            const keyword = String(sourceSearch.value || "").trim().toLowerCase();
            if (!keyword) return dataSources.value || [];
            return (dataSources.value || []).filter((ds) => {
              const haystack = [
                ds.id,
                ds.name,
                ds.description,
                ...(Array.isArray(ds.tables) ? ds.tables : []),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return haystack.includes(keyword);
            });
          });
          const selectedCount = computed(() => (selectedDataSources.value || []).length);

          function formatNumber(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return "--";
            return new Intl.NumberFormat("zh-CN").format(num);
          }

          function openChat() {
            window.location.href = "./";
          }

          async function refreshMe() {
            try {
              const res = await apiFetch("/auth/me");
              me.value = res.user || null;
            } catch {
              me.value = null;
            }
          }

          async function doLogin() {
            busy.value = true;
            loginError.value = "";
            try {
              await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(login.value) });
              showLogin.value = false;
              await refreshMe();
              await refreshDataSources();
              await refreshExamples();
              await refreshMetrics();
            } catch (e) {
              loginError.value = e.message || "登录失败";
            } finally {
              busy.value = false;
            }
          }

          async function logout() {
            await apiFetch("/auth/logout", { method: "POST" });
            me.value = null;
            metrics.value = null;
            dataSources.value = [];
            showLogin.value = true;
          }

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

          function normalizeTableText(text) {
            return (text || "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
          }

          function defaultPortByDbType(dbType) {
            if (dbType === "mysql") return "3306";
            if (dbType === "postgres") return "5432";
            if (dbType === "clickhouse") return "8123";
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

            const schemeMap = {
              mysql: "mysql+pymysql",
              postgres: "postgresql+psycopg",
              clickhouse: "clickhouse+http",
            };
            const scheme = schemeMap[dbType] || "postgresql+psycopg";
            const auth = password
              ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
              : encodeURIComponent(username);
            const base = `${scheme}://${auth}@${host}${port ? `:${port}` : ""}/${encodeURIComponent(database)}`;
            return options ? `${base}?${options}` : base;
          }

          function manualDbUrlPreview() {
            return buildManualDbUrl(addSource.value);
          }

          async function submitAddSource() {
            if (addSourceLoading.value) return;
            const id = (addSource.value.id || "").trim();
            const name = (addSource.value.name || "").trim();
            const description = (addSource.value.description || "").trim();
            const dbType = String(addSource.value.db_type || "sqlite").trim().toLowerCase();
            const mode = String(addSource.value.connection_mode || "url").trim().toLowerCase();
            const db_path = (addSource.value.db_path || "").trim();
            const db_url = dbType === "sqlite"
              ? ""
              : (mode === "manual" ? buildManualDbUrl(addSource.value) : (addSource.value.db_url || "").trim());
            const tables = normalizeTableText(addSource.value.tablesText);
            if (!id) {
              antd.message.error("请填写数据源ID");
              return;
            }
            if (!name) {
              antd.message.error("请填写名称");
              return;
            }
            if (!tables.length) {
              antd.message.error("请填写表名");
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
            if (dbType !== "sqlite" && !db_url) {
              antd.message.error("请填写数据库连接地址");
              return;
            }
            addSourceLoading.value = true;
            try {
              const payload = { id, name, description, db_type: dbType || "sqlite", tables };
              if (dbType === "sqlite" && db_path) payload.db_path = db_path;
              if (dbType !== "sqlite") payload.db_url = db_url;
              await apiFetch("/datasources", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("数据源已新增");
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
              if (!selectedDataSources.value.includes(id)) selectedDataSources.value.push(id);
              await refreshDataSources();
            } catch (e) {
              antd.message.error(e.message || "保存失败");
            } finally {
              addSourceLoading.value = false;
            }
          }

          async function submitAddTable() {
            if (addTableLoading.value) return;
            const id = (addTable.value.datasourceId || "").trim();
            const name = (addTable.value.datasourceName || "").trim();
            const description = (addTable.value.datasourceDescription || "").trim();
            const dbPath = (addTable.value.dbPath || "").trim();
            const tableName = (addTable.value.tableName || "").trim();
            const columnsText = (addTable.value.columnsText || "").trim();
            const rowsText = (addTable.value.rowsText || "").trim();

            if (!id) {
              antd.message.error("请填写数据源ID");
              return;
            }
            if (!tableName) {
              antd.message.error("请填写表名");
              return;
            }
            if (!columnsText) {
              antd.message.error("请填写字段定义");
              return;
            }

            const columns = columnsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [namePart, typePart] = line.split(":");
                return { name: (namePart || "").trim(), type: (typePart || "TEXT").trim() };
              })
              .filter((c) => c.name);

            if (!columns.length) {
              antd.message.error("字段定义不正确");
              return;
            }

            let rows = [];
            if (rowsText) {
              try {
                rows = JSON.parse(rowsText);
                if (!Array.isArray(rows)) rows = [];
              } catch {
                antd.message.error("示例数据格式错误（需JSON数组）");
                return;
              }
            }

            addTableLoading.value = true;
            try {
              const payload = {
                id,
                name,
                description,
                tables: [tableName],
                create_table: { name: tableName, columns, rows },
              };
              if (dbPath) payload.db_path = dbPath;
              await apiFetch("/datasources", { method: "POST", body: JSON.stringify(payload) });
              antd.message.success("表格已新增");
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
              if (!selectedDataSources.value.includes(id)) selectedDataSources.value.push(id);
              await refreshDataSources();
            } catch (e) {
              antd.message.error(e.message || "保存失败");
            } finally {
              addTableLoading.value = false;
            }
          }

          function sanitizeIdentifier(name, fallback) {
            const safe = (name || "").toString().trim().replace(/[^\w]/g, "_");
            if (!safe) return fallback || "";
            if (/^\d/.test(safe)) return `_${safe}`;
            return safe;
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

          function confirmDeleteDatasource(ds) {
            if (!ds || !ds.id || ds.is_default) return;
            try {
              antd.Modal.confirm({
                title: "确认删除数据源？",
                content: `将从列表移除「${ds.name || ds.id}」，已上传表格不再可查询。`,
                okText: "删除",
                okType: "danger",
                cancelText: "取消",
                onOk: async () => {
                  try {
                    await apiFetch(`/datasources/${encodeURIComponent(ds.id)}`, { method: "DELETE" });
                    selectedDataSources.value = (selectedDataSources.value || []).filter((id) => id !== ds.id);
                    await refreshDataSources();
                    antd.message.success("已删除");
                  } catch (e) {
                    antd.message.error(e.message || "删除失败");
                  }
                },
              });
            } catch {}
          }

          function fillExample(ex) {
            const text = (ex || "").trim();
            if (!text) return;
            try {
              navigator.clipboard.writeText(text);
              antd.message.success("示例已复制，可回到智能问数粘贴");
            } catch {
              antd.message.info("已点击示例，可回到智能问数手动输入");
            }
          }

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
              await refreshDataSources();
              await refreshExamples();
              await refreshMetrics();
            } else {
              showLogin.value = true;
            }
          });

          // ==============================
          // 模板暴露区
          // ==============================
          return {
            me,
            brand,
            showLogin,
            login,
            loginError,
            busy,
            openChat,
            refreshDataSources,
            refreshMetrics,
            refreshExamples,
            doLogin,
            logout,
            dataSources,
            selectedDataSources,
            examples,
            metrics,
            metricsLoading,
            sourceSearch,
            filteredDataSources,
            selectedCount,
            formatNumber,
            showAddSource,
            showAddTable,
            showUploadTable,
            addSource,
            addTable,
            dbTypeOptions,
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
            confirmDeleteDatasource,
            fillExample,
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
