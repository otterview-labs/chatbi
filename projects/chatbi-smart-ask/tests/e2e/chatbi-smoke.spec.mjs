import { test, expect } from '@playwright/test';

const BASE = (process.env.APP_URL || 'http://127.0.0.1:9010').replace(/\/$/, '');
const USERNAME = process.env.APP_USERNAME || 'admin';
const PASSWORD = process.env.APP_PASSWORD || 'admin123';

test.setTimeout(180000);

test.afterEach(async ({ page }, testInfo) => {
  // 出错时保留整页截图，便于快速复盘页面状态。
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true }).catch(() => {});
  }
});

test('chatbi app smoke', async ({ page }) => {
  const api5xx = [];
  const apiHits = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    apiHits.push(`${response.status()} ${response.request().method()} ${url.replace(BASE, '')}`);
    if (response.status() >= 500) {
      api5xx.push(`${response.status()} ${url}`);
    }
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 首页打开后默认会弹登录框，先完成登录。
  const loginModal = page.locator('.ant-modal').last();
  await loginModal.waitFor({ state: 'visible', timeout: 30000 });
  await loginModal.locator('input').first().fill(USERNAME);
  await loginModal.locator('input[type="password"]').fill(PASSWORD);
  await loginModal.locator('.ant-btn-primary').last().click();

  // 首页至少要确认：主按钮、实时概览、KPI、默认结果区都正常出现。
  await expect(page.getByRole('button', { name: '一键问数' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('实时概览')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.kpi .kpi-value').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('查询结果').first()).toBeVisible({ timeout: 120000 });

  // 验证首页返回的 SQL 可以再次执行。
  const rerunResp = page.waitForResponse(
    (response) => response.url().includes('/api/sql/run') && response.request().method() === 'POST' && response.status() === 200,
    { timeout: 30000 }
  );
  await page.getByRole('button', { name: '运行SQL' }).last().click();
  await rerunResp;

  // 验证首页结果可以成功“上屏”。
  const pinResp = page.waitForResponse(
    (response) => response.url().includes('/api/charts/pin') && response.request().method() === 'POST' && response.status() === 200,
    { timeout: 30000 }
  );
  await page.locator('button').filter({ hasText: /上\s*屏/ }).first().click();
  await pinResp;

  // 跳到 Dashboard，确认图表大屏能正常显示图表卡片。
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 });
  await expect(page.locator('.title').filter({ hasText: '图表大屏' }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.chart').first()).toBeVisible({ timeout: 30000 });

  // 进入数据开发页，验证任务详情和启动运行链路。
  await page.goto(`${BASE}/data-dev`, { waitUntil: 'networkidle', timeout: 30000 });
  await expect(page.getByText('任务列表')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.task-item').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.task-item').first().click();
  await page.getByRole('tab', { name: '运行监控' }).click();

  const runResp = page.waitForResponse(
    (response) => /\/api\/dev\/tasks\/.+\/runs$/.test(response.url()) && response.request().method() === 'POST' && response.status() === 200,
    { timeout: 30000 }
  );
  await page.getByRole('button', { name: '启动一次运行' }).click();
  await runResp;
  await expect(page.getByText('任务详情')).toBeVisible({ timeout: 30000 });

  // 最后验证数据源页的筛选和空状态文案。
  await page.goto(`${BASE}/datasources`, { waitUntil: 'networkidle', timeout: 30000 });
  await expect(page.locator('.brand-title').filter({ hasText: '数据源管理' }).first()).toBeVisible({ timeout: 30000 });
  const search = page.getByPlaceholder('按名称 / ID / 表名筛选数据源');
  await search.fill('不存在的数据源');
  await expect(page.getByText('未找到匹配数据源')).toBeVisible({ timeout: 30000 });
  await search.fill('alarm');
  await expect(page.locator('.ds-item').first()).toBeVisible({ timeout: 30000 });

  // 本轮页面链路不允许出现任何未预期 5xx 接口错误。
  expect(api5xx).toEqual([]);
  console.log('API_HITS_START');
  for (const hit of apiHits) console.log(hit);
  console.log('API_HITS_END');
});
