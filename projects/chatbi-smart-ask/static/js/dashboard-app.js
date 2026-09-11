      const { createApp, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } = Vue;

      // apiFetch / loadBrandConfig / applyBrandToShell / 数据源选择持久化
      // 等公共函数已提取到 static/js/common.js（页面加载顺序里排在本文件之前）。
      const apiFetch = makeApiFetch("api");

      function defaultBrandConfig() {
        return {
          sideLogo: "粤消",
        };
      }

      function buildOption(cfg, rows) {
        const type = (cfg && cfg.type) || "table";
        if (!cfg || !rows || !rows.length || type === "table") return null;

        const option = { title: { text: cfg.title || "" , textStyle:{ color:'#334155' } }, tooltip: {}, grid: { left: 40, right: 20, top: 60, bottom: 40 } };
        option.textStyle = { color: "#334155" };

        if (["line", "bar", "area", "bar_group", "bar_stack", "bar_horizontal"].includes(type)) {
          const xField = cfg.xField;
          const yField = cfg.yField;
          const yFields = cfg.yFields;
          const seriesField = cfg.seriesField;
          const valueField = cfg.valueField || yField;
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
            series = [{ type: isLine ? "line" : "bar", data: rows.map((r) => r[valueField]) }];
          }

          if (isHorizontal) {
            option.xAxis = { type: "value", axisLabel:{ color:'#334155' } };
            option.yAxis = { type: "category", data: categories, axisLabel:{ color:'#334155' } };
          } else {
            option.xAxis = { type: "category", data: categories, axisLabel:{ color:'#334155' } };
            option.yAxis = { type: "value", axisLabel:{ color:'#334155' } };
          }
          option.series = series;
        } else if (type === "pie") {
          const nameField = cfg.nameField;
          const valueField = cfg.valueField;
          option.series = [{
            type: "pie",
            radius: "70%",
            data: rows.map((r) => ({ name: r[nameField], value: r[valueField] })),
            label: { color: "#334155" }
          }];
        } else if (type === "heatmap") {
          const xField = cfg.xField;
          const yField = cfg.yField;
          const valueField = cfg.valueField;
          const xs = Array.from(new Set(rows.map((r) => r[xField])));
          const ys = Array.from(new Set(rows.map((r) => r[yField])));
          const data = rows.map((r) => [xs.indexOf(r[xField]), ys.indexOf(r[yField]), r[valueField]]);
          option.xAxis = { type: "category", data: xs, axisLabel:{ color:'#334155' } };
          option.yAxis = { type: "category", data: ys, axisLabel:{ color:'#334155' } };
          option.visualMap = { min: 0, max: Math.max(...rows.map((r) => r[valueField] || 0)), calculable: true, orient: "horizontal", left: "center", bottom: 0, textStyle:{ color:'#334155' } };
          option.series = [{ type: "heatmap", data }];
          option.grid.bottom = 70;
        } else if (type === "scatter") {
          const xField = cfg.xField;
          const yField = cfg.yField;
          option.xAxis = { type: "value", axisLabel:{ color:'#334155' } };
          option.yAxis = { type: "value", axisLabel:{ color:'#334155' } };
          option.series = [{ type: "scatter", data: rows.map((r) => [r[xField], r[yField]]) }];
        }
        return option;
      }

      const app = createApp({
        setup() {
          // ==============================
          // 大屏状态区：登录态、图表列表、概览指标、刷新控制
          // ==============================
          const busy = ref(false);
          const asking = ref(false);
          const askText = ref("");
          const me = ref(null);
          const brand = ref(loadBrandConfig(defaultBrandConfig()));
          const showLogin = ref(false);
          const login = ref({ username: "", password: "" });
          const loginError = ref("");
          const charts = ref([]);
          const metrics = ref(null);
          const metricsLoading = ref(false);
          const autoRefresh = ref(true);
          const lastRefreshAt = ref(0);
          const lastRefreshLabel = computed(() => {
            if (!lastRefreshAt.value) return "";
            const dt = new Date(lastRefreshAt.value);
            const hh = String(dt.getHours()).padStart(2, "0");
            const mm = String(dt.getMinutes()).padStart(2, "0");
            const ss = String(dt.getSeconds()).padStart(2, "0");
            return `刷新于 ${hh}:${mm}:${ss}`;
          });
          const chartInstances = new Map();
          let refreshTimer = null;
          let resizeHandler = null;

          // ==============================
          // 刷新逻辑区：用户信息、指标、图表与自动刷新定时器
          // ==============================
          async function refreshMetrics() {
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
              me.value = res.user || null;
            } catch {
              me.value = null;
            }
          }

          function formatNumber(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return "--";
            return new Intl.NumberFormat("zh-CN").format(num);
          }

          function disposeChart(resultId) {
            const inst = chartInstances.get(resultId);
            if (!inst) return;
            try { inst.dispose(); } catch {}
            chartInstances.delete(resultId);
          }

          function disposeMissingCharts() {
            const keep = new Set((charts.value || []).map((item) => item.result_id));
            for (const resultId of Array.from(chartInstances.keys())) {
              if (!keep.has(resultId)) disposeChart(resultId);
            }
          }

          function syncRefreshTimer() {
            if (refreshTimer) {
              clearInterval(refreshTimer);
              refreshTimer = null;
            }
            if (!autoRefresh.value || !me.value) return;
            refreshTimer = setInterval(() => {
              if (!busy.value && !asking.value) refresh();
            }, 15000);
          }

          async function doLogin() {
            busy.value = true;
            loginError.value = "";
            try {
              await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(login.value) });
              showLogin.value = false;
              await refreshMe();
              await refresh();
            } catch (e) {
              loginError.value = e.message || "登录失败";
            } finally {
              busy.value = false;
            }
          }

          async function logout() {
            await apiFetch("/auth/logout", { method: "POST" });
            me.value = null;
            charts.value = [];
            metrics.value = null;
            lastRefreshAt.value = 0;
            syncRefreshTimer();
            for (const resultId of Array.from(chartInstances.keys())) disposeChart(resultId);
            showLogin.value = true;
          }

          async function refresh() {
            busy.value = true;
            try {
              if (!me.value) {
                showLogin.value = true;
                return;
              }
              const [res] = await Promise.all([apiFetch("/charts"), refreshMetrics()]);
              charts.value = res.data || [];
              lastRefreshAt.value = Date.now();
              if (!charts.value.length) {
                try {
                  const seeded = await apiFetch("/demo/seed-dashboard", { method: "POST" });
                  charts.value = seeded.data || [];
                } catch {}
              }
              await nextTick();
              renderAll();
              syncRefreshTimer();
            } catch (e) {
              const msg = e && e.message ? e.message : "";
              if (msg.includes("未登录") || msg.includes("401")) {
                showLogin.value = true;
                return;
              }
              antd.message.error(e.message || "刷新失败（请先登录并从问数页上屏）");
            } finally {
              busy.value = false;
            }
          }

          function renderAll() {
            disposeMissingCharts();
            for (const c of charts.value) {
              const el = document.getElementById(`chart_${c.result_id}`);
              if (!el) continue;
              let inst = chartInstances.get(c.result_id);
              if (!inst) {
                inst = echarts.init(el);
                chartInstances.set(c.result_id, inst);
              }
              const option = buildOption(c.chart, c.data);
              if (option) inst.setOption(option, true);
              else inst.clear();
              try { inst.resize(); } catch {}
            }
          }

          async function remove(resultId) {
            try {
              await apiFetch(`/charts/${resultId}`, { method: "DELETE" });
              await refresh();
            } catch (e) {
              antd.message.error(e.message || "移除失败");
            }
          }

          async function askAndPin() {
            const q = askText.value.trim();
            if (!q) return;
            if (!me.value) {
              showLogin.value = true;
              return;
            }
            asking.value = true;
            try {
              const res = await apiFetch("/chat", { method: "POST", body: JSON.stringify({ question: q }) });
              if (res && res.result_id) {
                await apiFetch("/charts/pin", { method: "POST", body: JSON.stringify({ result_id: res.result_id }) });
              }
              askText.value = "";
              await refresh();
              antd.message.success("已上屏");
            } catch (e) {
              antd.message.error(e.message || "提问上屏失败（请先在问数页登录）");
            } finally {
              asking.value = false;
            }
          }

          function back() {
            window.location.href = "./";
          }

          // ==============================
          // 生命周期区：自动刷新监听、窗口 resize、挂载与销毁
          // ==============================
          watch(autoRefresh, () => {
            syncRefreshTimer();
          });

          onMounted(async () => {
            applyBrandToShell(brand.value);
            window.addEventListener("smartask-auth-required", () => {
              showLogin.value = true;
            });
            resizeHandler = () => {
              for (const inst of chartInstances.values()) {
                try { inst.resize(); } catch {}
              }
            };
            window.addEventListener("resize", resizeHandler);
            await refreshMe();
            if (me.value) {
              await refresh();
            } else {
              showLogin.value = true;
            }
            syncRefreshTimer();
          });

          onBeforeUnmount(() => {
            if (refreshTimer) clearInterval(refreshTimer);
            if (resizeHandler) window.removeEventListener("resize", resizeHandler);
            for (const resultId of Array.from(chartInstances.keys())) disposeChart(resultId);
          });

          // ==============================
          // 模板暴露区
          // ==============================
          return {
            busy,
            asking,
            askText,
            me,
            brand,
            showLogin,
            login,
            loginError,
            doLogin,
            logout,
            charts,
            metrics,
            metricsLoading,
            autoRefresh,
            lastRefreshLabel,
            formatNumber,
            refresh,
            remove,
            askAndPin,
            back,
          };
        },
      });
      app.use(antd);
      app.mount("#app");
