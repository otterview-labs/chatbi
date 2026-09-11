      const { createApp, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } = Vue;

      // apiFetch / loadBrandConfig / applyBrandToShell 等公共函数已提取到
      // static/js/common.js（页面加载顺序里排在本文件之前）。
      // 本页面兼有 /api/dev/* 前缀的 apiFetch 和 /api/* 前缀的 baseFetch。
      const apiFetch = makeApiFetch("api/dev");
      const baseFetch = makeApiFetch("api");

      function fmtTime(ms) {
        if (!ms) return "-";
        return dayjs(Number(ms)).format("YYYY-MM-DD HH:mm:ss");
      }

      function defaultBrandConfig() {
        return {
          sideLogo: "粤消",
        };
      }

      const app = createApp({
        setup() {
          // ==============================
          // 数据开发页状态区：任务、详情、版本、运行记录、联动模拟结果
          // ==============================
          const busy = ref(false);
          const me = ref(null);
          const brand = ref(loadBrandConfig(defaultBrandConfig()));
          const showLogin = ref(false);
          const login = ref({ username: "", password: "" });
          const loginError = ref("");

          const tasks = ref([]);
          const keyword = ref("");
          const statusFilter = ref("全部");
          const statusOptions = ["全部", "运行中", "草稿", "失败"];

          const selectedTask = ref(null);
          const versions = ref([]);
          const versionComment = ref("");
          const versionSaving = ref(false);

          const activeTab = ref("pipeline");

          const runs = ref([]);
          const selectedRunId = ref("");
          const runStarting = ref(false);
          const runView = ref(null);
          const runLogs = ref([]);
          const runPoll = ref(null);
          const lastRefreshAt = ref(0);
          const lastRunRefreshAt = ref(0);
          let resizeHandler = null;

          const showCreate = ref(false);
          const creating = ref(false);
          const createForm = ref({ name: "实时任务-" + dayjs().format("HHmmss"), type: "flink_realtime", description: "" });
          const taskTypeOptions = [
            { value: "flink_realtime", label: "Flink 实时任务" },
            { value: "flink_sql", label: "Flink SQL 任务" },
            { value: "sync_linkage", label: "联动推送任务" },
          ];

          const restartOptions = [
            { value: "fixed-delay", label: "fixed-delay" },
            { value: "failure-rate", label: "failure-rate" },
            { value: "none", label: "none" },
          ];

          // DAG
          const dagEl = ref(null);
          let dagChart = null;
          const palette = [
            { kind: "kafka_source", category: "source", name: "Kafka实时源", desc: "智能接处警/定位/GPS 等实时流接入" },
            { kind: "cleanse", category: "transform", name: "字段清洗", desc: "去空/标准化/字段映射，无需手写代码" },
            { kind: "window_agg", category: "transform", name: "窗口聚合", desc: "5s/1min 等窗口统计计算" },
            { kind: "geo_cleanse", category: "transform", name: "轨迹清洗/纠偏", desc: "定位/轨迹去噪、限速、纠偏" },
            { kind: "ods_sink", category: "sink", name: "ODS写入", desc: "落地 ODS 明细表" },
            { kind: "warehouse_sink", category: "sink", name: "主题库写入", desc: "写入 DWD/ADS 主题库" },
            { kind: "push_sink", category: "sink", name: "指挥大屏推送", desc: "联动推送到指挥系统/大屏" },
          ];
          const dragKind = ref("");
          const dragOver = ref(false);
          const edgeSource = ref("");
          const edgeTarget = ref("");

          const nodeDrawerOpen = ref(false);
          const editingNode = ref(null);
          const editingNodeParamsText = ref("{}");

          // Sources modal
          const sourceModalOpen = ref(false);
          const sources = ref([]);

          // ==============================
          // 联动模拟区：用于演示告警触发后的推荐力量与推送结果
          // ==============================
          // Linkage simulate
          const simulating = ref(false);
          const simulateModalOpen = ref(false);
          const simulateResult = ref(null);

          const linkageEnabledNames = computed({
            get() {
              const t = selectedTask.value;
              if (!t || !t.linkage || !Array.isArray(t.linkage.rules)) return [];
              return t.linkage.rules.filter(r => r.enabled !== false).map(r => r.name);
            },
            set(names) {
              const t = selectedTask.value;
              if (!t || !t.linkage || !Array.isArray(t.linkage.rules)) return;
              t.linkage.rules = t.linkage.rules.map(r => ({ ...r, enabled: names.includes(r.name) }));
            }
          });

          const taskOverview = computed(() => {
            const items = tasks.value || [];
            const latest = items.length ? Math.max(...items.map((t) => Number(t.updated_at || 0) || 0)) : 0;
            return {
              total: items.length,
              running: items.filter((t) => t.status === 'running').length,
              failed: items.filter((t) => t.status === 'failed').length,
              latestUpdate: latest ? fmtTime(latest) : '—',
            };
          });

          const filteredEmptyText = computed(() => {
            if ((tasks.value || []).length && ((keyword.value || '').trim() || statusFilter.value !== '全部')) {
              return '当前筛选条件下暂无任务，请调整关键词或状态。';
            }
            return '暂无任务（点击右上角“新建任务”创建实时任务）';
          });

          const lastRefreshLabel = computed(() => {
            if (!lastRefreshAt.value) return '';
            return `刷新于 ${fmtTime(lastRefreshAt.value)}`;
          });

          const runRefreshLabel = computed(() => {
            if (!lastRunRefreshAt.value) return '';
            return `运行刷新 ${fmtTime(lastRunRefreshAt.value)}`;
          });

          const runPollActive = computed(() => !!runPoll.value);
          const runProgressPercent = computed(() => {
            const progress = Number(runView.value && runView.value.progress);
            if (!Number.isFinite(progress)) return 0;
            return Math.max(0, Math.min(100, Math.round(progress * 100)));
          });
          const runLogCount = computed(() => (runLogs.value || []).length);
          const runProgressStatus = computed(() => {
            const status = runView.value && runView.value.status;
            if (status === 'failed') return 'exception';
            if (status === 'success') return 'success';
            return 'active';
          });

          const filteredTasks = computed(() => {
            const k = (keyword.value || "").trim().toLowerCase();
            return (tasks.value || []).filter((t) => {
              const hit = !k || String(t.name || "").toLowerCase().includes(k) || String(t.description || "").toLowerCase().includes(k);
              if (!hit) return false;
              const st = String(t.status || "");
              if (statusFilter.value === "运行中") return st === "running";
              if (statusFilter.value === "草稿") return st === "draft";
              if (statusFilter.value === "失败") return st === "failed";
              return true;
            });
          });

          const nodeIdOptions = computed(() => {
            const p = (selectedTask.value && selectedTask.value.pipeline) || {};
            const ns = p.nodes || [];
            return ns.map(n => ({ value: n.id, label: `${n.name} (${n.id})` }));
          });

          const runColumns = [
            { title: "ID", dataIndex: "id", key: "id", ellipsis: true },
            { title: "开始时间", dataIndex: "started_at", key: "started_at", customRender: ({ text }) => fmtTime(text) },
            { title: "耗时(ms)", dataIndex: "duration_ms", key: "duration_ms" },
            { title: "状态", dataIndex: "status", key: "status" },
          ];

          const runTableData = computed(() => (runs.value || []).map((r) => ({ ...r, status: r.status || (r.final_status ? "finished" : "unknown") })));

          const runLogText = computed(() => {
            if (!runLogs.value || !runLogs.value.length) return "（暂无日志）";
            return runLogs.value.map((l) => `[${fmtTime(l.ts)}] ${l.level || "INFO"} ${l.msg || ""}`).join("\\n");
          });

          function fmtNumber(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return '-';
            return new Intl.NumberFormat('zh-CN').format(num);
          }

          function fmtPercent(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return '-';
            return `${Math.round(num * 100)}%`;
          }

          function shortRunId(value) {
            const text = String(value || '');
            return text ? text.slice(0, 8) : '—';
          }

          function stopPolling() {
            if (runPoll.value) {
              clearInterval(runPoll.value);
              runPoll.value = null;
            }
          }

          function statusColor(status) {
            if (status === "running") return "green";
            if (status === "draft") return "purple";
            if (status === "failed") return "red";
            if (status === "success") return "green";
            if (status === "stopped") return "default";
            return "default";
          }

          function statusText(status) {
            if (status === "running") return "运行中";
            if (status === "draft") return "草稿";
            if (status === "failed") return "失败";
            if (status === "success") return "成功";
            if (status === "stopped") return "已停止";
            return status || "—";
          }

          function back() {
            window.location.href = "./";
          }

          async function refreshMe() {
            try {
              const res = await baseFetch("/auth/me");
              me.value = res.user || null;
            } catch {
              me.value = null;
            }
          }

          async function doLogin() {
            busy.value = true;
            loginError.value = "";
            try {
              await baseFetch("/auth/login", { method: "POST", body: JSON.stringify(login.value) });
              showLogin.value = false;
              await refreshMe();
              await refresh();
              await nextTick(renderDag);
            } catch (e) {
              loginError.value = e.message || "登录失败";
            } finally {
              busy.value = false;
            }
          }

          async function logout() {
            await baseFetch("/auth/logout", { method: "POST" });
            me.value = null;
            tasks.value = [];
            selectedTask.value = null;
            runs.value = [];
            selectedRunId.value = "";
            runView.value = null;
            runLogs.value = [];
            lastRefreshAt.value = 0;
            lastRunRefreshAt.value = 0;
            stopPolling();
            showLogin.value = true;
          }

          function confirmReset() {
            try {
              antd.Modal.confirm({
                title: "确认重置数据开发？",
                content: "将清空当前用户的任务/运行记录，并恢复系统预置实时任务（便于重复验证）。",
                okText: "重置",
                cancelText: "取消",
                onOk: resetDev,
              });
            } catch {
              resetDev();
            }
          }

          // ==============================
          // 请求动作区：重置、加载任务、加载详情、版本、运行、模拟触发
          // ==============================
          async function resetDev() {
            busy.value = true;
            try {
              await apiFetch("/reset", { method: "POST" });
              selectedTask.value = null;
              versions.value = [];
              runs.value = [];
              selectedRunId.value = "";
              runView.value = null;
              runLogs.value = [];
              lastRunRefreshAt.value = 0;
              stopPolling();
              antd.message.success("数据开发已重置");
              await refresh();
            } catch (e) {
              antd.message.error(e.message || "重置失败");
            } finally {
              busy.value = false;
            }
          }

          async function refresh() {
            busy.value = true;
            try {
              const res = await apiFetch("/tasks");
              tasks.value = res.data || [];
              lastRefreshAt.value = Date.now();
              if (!selectedTask.value && tasks.value.length) {
                await selectTask(tasks.value[0].id);
              } else if (selectedTask.value) {
                const still = tasks.value.find((t) => t.id === selectedTask.value.id);
                if (!still && tasks.value.length) await selectTask(tasks.value[0].id);
                if (!still && !tasks.value.length) {
                  selectedTask.value = null;
                  versions.value = [];
                  runs.value = [];
                  selectedRunId.value = "";
                  runView.value = null;
                  runLogs.value = [];
                  stopPolling();
                }
              }
            } catch (e) {
              antd.message.error(e.message || "加载失败");
            } finally {
              busy.value = false;
            }
          }

          async function selectTask(id) {
            try {
              const res = await apiFetch(`/tasks/${id}`);
              selectedTask.value = res.data;
              versions.value = (res.data && res.data.versions) ? res.data.versions.slice().sort((a,b)=> (b.version||0)-(a.version||0)) : [];
              await refreshRuns();
              await nextTick();
              renderDag();
            } catch (e) {
              antd.message.error(e.message || "加载任务失败");
            }
          }

          function normalizePipeline() {
            const t = selectedTask.value;
            if (!t) return;
            if (!t.pipeline) t.pipeline = { nodes: [], edges: [] };
            if (!Array.isArray(t.pipeline.nodes)) t.pipeline.nodes = [];
            if (!Array.isArray(t.pipeline.edges)) t.pipeline.edges = [];
            if (!t.runtime) t.runtime = { parallelism: 4, checkpoint_interval_ms: 10000 };
            if (!t.linkage) t.linkage = { enabled: true, trigger: "警情触发", rules: [] };
            if (!Array.isArray(t.linkage.rules)) t.linkage.rules = [];
          }

          function computeLayout(nodes, edges) {
            const indeg = new Map();
            const adj = new Map();
            for (const n of nodes) {
              indeg.set(n.id, 0);
              adj.set(n.id, []);
            }
            for (const e of edges) {
              if (!adj.has(e.source) || !indeg.has(e.target)) continue;
              adj.get(e.source).push(e.target);
              indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
            }
            const q = [];
            const depth = new Map();
            for (const n of nodes) {
              if ((indeg.get(n.id) || 0) === 0) { q.push(n.id); depth.set(n.id, 0); }
            }
            while (q.length) {
              const cur = q.shift();
              const d = depth.get(cur) || 0;
              for (const nxt of (adj.get(cur) || [])) {
                depth.set(nxt, Math.max(depth.get(nxt) || 0, d + 1));
                indeg.set(nxt, (indeg.get(nxt) || 0) - 1);
                if ((indeg.get(nxt) || 0) === 0) q.push(nxt);
              }
            }
            const groups = {};
            for (const n of nodes) {
              const d = depth.get(n.id) || 0;
              if (!groups[d]) groups[d] = [];
              groups[d].push(n);
            }
            const ds = Object.keys(groups).map(Number).sort((a,b)=>a-b);
            const laid = [];
            for (const d of ds) {
              const arr = groups[d];
              arr.sort((a,b)=> String(a.category||'').localeCompare(String(b.category||'')) || String(a.name||'').localeCompare(String(b.name||'')) );
              for (let i=0;i<arr.length;i++) {
                const n = arr[i];
                const x = (typeof n.x === "number") ? n.x : (80 + d * 280);
                const y = (typeof n.y === "number") ? n.y : (80 + i * 96);
                laid.push({ ...n, _x: x, _y: y });
              }
            }
            if (laid.length !== nodes.length) {
              // fallback
              return nodes.map((n, i) => {
                const x = (typeof n.x === "number") ? n.x : (80 + (i % 3) * 280);
                const y = (typeof n.y === "number") ? n.y : (80 + Math.floor(i / 3) * 96);
                return { ...n, _x: x, _y: y };
              });
            }
            return laid;
          }

          function renderDag() {
            if (!dagEl.value) return;
            if (!dagChart) dagChart = echarts.init(dagEl.value);
            if (!selectedTask.value) { dagChart.clear(); return; }
            normalizePipeline();
            const p = selectedTask.value.pipeline;
            const nodes = computeLayout(p.nodes || [], p.edges || []);
            const data = nodes.map((n) => ({
              id: n.id,
              name: n.name || n.id,
              x: n._x,
              y: n._y,
              value: n.category,
              symbolSize: 56,
              draggable: true,
              itemStyle: { color: n.category === "source" ? "#06b6d4" : (n.category === "sink" ? "#22c55e" : "#7c3aed") },
              label: { show: true, color: "#0f172a", formatter: (p) => p.data.name, fontWeight: 800 },
            }));
            const links = (p.edges || []).map((e) => ({ source: e.source, target: e.target, lineStyle: { color: "rgba(15,23,42,0.25)", width: 2 } }));
            const option = {
              tooltip: { trigger: "item" },
              series: [{
                type: "graph",
                layout: "none",
                data,
                links,
                roam: true,
                label: { position: "bottom" },
                edgeSymbol: ["circle", "arrow"],
                edgeSymbolSize: [4, 10],
                lineStyle: { curveness: 0.2 },
              }],
            };
            dagChart.setOption(option, true);
            dagChart.off("click");
            dagChart.on("click", (params) => {
              if (!params || params.dataType !== "node") return;
              const id = params.data && params.data.id;
              const node = (p.nodes || []).find((n) => n.id === id);
              if (!node) return;
              editingNode.value = JSON.parse(JSON.stringify(node));
              editingNodeParamsText.value = JSON.stringify(node.params || {}, null, 2);
              nodeDrawerOpen.value = true;
            });
          }

          function onDragStart(kind, ev) {
            dragKind.value = kind;
            try {
              ev.dataTransfer.setData("text/plain", kind);
              ev.dataTransfer.effectAllowed = "copy";
            } catch {}
          }

          function addNodeAt(kind, x, y) {
            if (!selectedTask.value) return;
            normalizePipeline();
            if (!kind) return;
            const id = "n_" + Math.random().toString(16).slice(2, 10);
            const category = kind.includes("source") ? "source" : (kind.includes("sink") ? "sink" : "transform");
            const nameMap = {
              kafka_source: "Kafka实时源",
              cleanse: "字段清洗",
              window_agg: "窗口聚合",
              geo_cleanse: "轨迹清洗/纠偏",
              warehouse_sink: "主题库写入",
              ods_sink: "ODS写入",
              push_sink: "指挥大屏推送",
            };
            const px = (typeof x === "number") ? Math.round(x) : (140 + Math.round(Math.random() * 320));
            const py = (typeof y === "number") ? Math.round(y) : (120 + Math.round(Math.random() * 240));
            selectedTask.value.pipeline.nodes.push({
              id,
              category,
              kind,
              name: (nameMap[kind] || kind) + "-" + id.slice(-3),
              params: {},
              x: Math.max(40, px),
              y: Math.max(40, py),
            });
            nextTick(renderDag);
          }

          function onDrop(ev) {
            dragOver.value = false;
            const kind = dragKind.value || (ev.dataTransfer ? ev.dataTransfer.getData("text/plain") : "");
            if (!kind) return;
            let x = undefined;
            let y = undefined;
            try {
              const rect = dagEl.value.getBoundingClientRect();
              x = ev.clientX - rect.left;
              y = ev.clientY - rect.top;
            } catch {}
            addNodeAt(kind, x, y);
            dragKind.value = "";
          }

          function addEdge() {
            normalizePipeline();
            if (!edgeSource.value || !edgeTarget.value || edgeSource.value === edgeTarget.value) return;
            const exists = selectedTask.value.pipeline.edges.some((e) => e.source === edgeSource.value && e.target === edgeTarget.value);
            if (!exists) selectedTask.value.pipeline.edges.push({ source: edgeSource.value, target: edgeTarget.value });
            edgeSource.value = "";
            edgeTarget.value = "";
            nextTick(renderDag);
          }

          function saveNode() {
            try {
              const t = selectedTask.value;
              if (!t) return;
              normalizePipeline();
              const p = t.pipeline;
              const node = editingNode.value;
              if (!node) return;
              let params = {};
              try { params = JSON.parse(editingNodeParamsText.value || "{}"); } catch { params = {}; }
              const idx = (p.nodes || []).findIndex((n) => n.id === node.id);
              if (idx >= 0) {
                p.nodes[idx] = { ...node, params };
                editingNode.value = null;
                nodeDrawerOpen.value = false;
                nextTick(renderDag);
              }
            } catch (e) {
              antd.message.error("保存节点失败");
            }
          }

          async function saveTask() {
            if (!selectedTask.value) return;
            normalizePipeline();
            try {
              const res = await apiFetch(`/tasks/${selectedTask.value.id}`, { method: "PATCH", body: JSON.stringify(selectedTask.value) });
              selectedTask.value = res.data;
              await refresh();
              antd.message.success("已保存");
            } catch (e) {
              antd.message.error(e.message || "保存失败");
            }
          }

          async function saveVersion() {
            if (!selectedTask.value) return;
            versionSaving.value = true;
            try {
              const res = await apiFetch(`/tasks/${selectedTask.value.id}/versions`, { method: "POST", body: JSON.stringify({ comment: versionComment.value }) });
              selectedTask.value = res.data;
              versions.value = (res.data.versions || []).slice().sort((a,b)=> (b.version||0)-(a.version||0));
              versionComment.value = "";
              antd.message.success("版本已生成");
            } catch (e) {
              antd.message.error(e.message || "保存版本失败");
            } finally {
              versionSaving.value = false;
            }
          }

          async function rollback(version) {
            if (!selectedTask.value) return;
            try {
              const res = await apiFetch(`/tasks/${selectedTask.value.id}/rollback`, { method: "POST", body: JSON.stringify({ version }) });
              selectedTask.value = res.data;
              versions.value = (res.data.versions || []).slice().sort((a,b)=> (b.version||0)-(a.version||0));
              await nextTick();
              renderDag();
              antd.message.success("已回滚并生成新版本");
            } catch (e) {
              antd.message.error(e.message || "回滚失败");
            }
          }

          async function refreshRuns() {
            if (!selectedTask.value) return;
            try {
              const res = await apiFetch(`/tasks/${selectedTask.value.id}/runs`);
              runs.value = res.data || [];
              if (selectedRunId.value && !runs.value.some((item) => item.id === selectedRunId.value)) {
                selectedRunId.value = "";
                runView.value = null;
                runLogs.value = [];
                stopPolling();
              }
              if (!selectedRunId.value && runs.value.length) {
                await selectRun(runs.value[0].id);
              }
            } catch {}
          }

          // ==============================
          // 任务动作区：启动运行、保存版本、回滚版本
          // ==============================
          async function startRun() {
            if (!selectedTask.value) return;
            runStarting.value = true;
            try {
              const res = await apiFetch(`/tasks/${selectedTask.value.id}/runs`, { method: "POST" });
              const runId = res.data && res.data.run_id;
              await refreshRuns();
              if (runId) await selectRun(runId);
              const effects = (res.data && res.data.effects) || [];
              if (effects.length) {
                for (const e of effects) {
                  if (e && e.message) antd.message.success(e.message);
                }
              } else {
                antd.message.success("任务已启动");
              }
            } catch (e) {
              antd.message.error(e.message || "启动失败");
            } finally {
              runStarting.value = false;
            }
          }

          async function selectRun(id) {
            selectedRunId.value = id;
            await refreshRun();
            startPolling();
          }

          async function refreshRun() {
            if (!selectedRunId.value) return;
            try {
              const res = await apiFetch(`/runs/${selectedRunId.value}`);
              runView.value = res.data.run;
              runLogs.value = res.data.logs || [];
              lastRunRefreshAt.value = Date.now();
              if (res.data.finished) {
                stopPolling();
              }
            } catch (e) {
              antd.message.error(e.message || "拉取运行信息失败");
            }
          }

          function startPolling() {
            stopPolling();
            if (!selectedRunId.value) return;
            runPoll.value = setInterval(async () => {
              if (!selectedRunId.value) return;
              await refreshRun();
            }, 900);
          }

          async function doCreate() {
            creating.value = true;
            try {
              const res = await apiFetch("/tasks", { method: "POST", body: JSON.stringify(createForm.value) });
              showCreate.value = false;
              await refresh();
              if (res.data && res.data.id) await selectTask(res.data.id);
              antd.message.success("任务已创建");
            } catch (e) {
              antd.message.error(e.message || "创建失败");
            } finally {
              creating.value = false;
            }
          }

          async function loadSources() {
            sourceModalOpen.value = true;
            try {
              const res = await apiFetch("/sources");
              sources.value = res.data || [];
            } catch {
              sources.value = [];
            }
          }

          async function simulate() {
            simulating.value = true;
            try {
              const res = await apiFetch("/simulate/linkage", { method: "POST", body: JSON.stringify({}) });
              simulateResult.value = res.data || null;
              simulateModalOpen.value = true;
            } catch (e) {
              antd.message.error(e.message || "模拟失败");
            } finally {
              simulating.value = false;
            }
          }

          watch(activeTab, async (k) => {
            if (k === "pipeline") await nextTick(renderDag);
          });

          resizeHandler = () => { try { if (dagChart) dagChart.resize(); } catch {} };
          window.addEventListener("resize", resizeHandler);

          onMounted(async () => {
            applyBrandToShell(brand.value);
            window.addEventListener("smartask-auth-required", () => {
              showLogin.value = true;
            });
            await refreshMe();
            if (!me.value) {
              showLogin.value = true;
              return;
            }
            await refresh();
            await nextTick(renderDag);
          });

          onBeforeUnmount(() => {
            stopPolling();
            if (resizeHandler) window.removeEventListener('resize', resizeHandler);
            try { if (dagChart) dagChart.dispose(); } catch {}
          });

          // ==============================
          // 模板暴露区
          // ==============================
          return {
            busy,
            me,
            brand,
            showLogin,
            login,
            loginError,
            doLogin,
            logout,
            tasks,
            keyword,
            statusFilter,
            statusOptions,
            taskOverview,
            filteredEmptyText,
            lastRefreshLabel,
            statusColor,
            statusText,
            filteredTasks,
            selectedTask,
            selectTask,
            fmtTime,

            activeTab,
            versions,
            versionComment,
            versionSaving,
            saveVersion,
            rollback,

            runColumns,
            runs,
            runTableData,
            runStarting,
            startRun,
            selectedRunId,
            runView,
            runLogs,
            runLogText,
            runRefreshLabel,
            runPollActive,
            runProgressPercent,
            runProgressStatus,
            runLogCount,
            fmtNumber,
            fmtPercent,
            shortRunId,
            refreshRun,
            selectRun,

            dagEl,
            nodeIdOptions,
            edgeSource,
            edgeTarget,
            addEdge,
            nodeDrawerOpen,
            editingNode,
            editingNodeParamsText,
            saveNode,
            saveTask,

            showCreate,
            creating,
            createForm,
            taskTypeOptions,
            doCreate,

            restartOptions,

            sourceModalOpen,
            sources,
            loadSources,

            linkageEnabledNames,
            simulate,
            simulating,
            simulateModalOpen,
            simulateResult,

            refresh,
            back,
            confirmReset,

            palette,
            dragOver,
            onDragStart,
            onDrop,
            addNodeAt,
          };
        },
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
