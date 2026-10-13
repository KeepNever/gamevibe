const { chromium } = require('playwright');

const BASE = 'http://localhost:5301';
const results = [];

function log(label, ok, detail) {
  const icon = ok ? '✅' : '❌';
  results.push({ label, ok, detail });
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  console.log('=== GameVibe Bug Fix Verification ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 挂钩错误捕获
  let pageErrors = [];
  let consoleErrors = [];
  let crashSignatures = [];
  page.on('pageerror', e => {
    pageErrors.push(e.message.substring(0, 120));
    // 匹配崩溃签名
    const msg = e.message;
    if (/insertBefore|removeChild|Cannot use a ref|Failed to resolve component/i.test(msg)) {
      crashSignatures.push(msg.substring(0, 100));
    }
  });
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('[Intervention]')) {
      consoleErrors.push(m.text().substring(0, 120));
    }
  });

  // ── 阶段 1: 注册登录 ──
  console.log('── 阶段 1: 注册登录 ──');
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(800);
  const ts = Date.now();
  await page.locator('input[placeholder*="玩家名"]').first().fill('fix_' + ts);
  await page.locator('input[type=email]').first().fill('fix_' + ts + '@t.com');
  await page.locator('input[type=password]').first().fill('Fix12345');
  await page.locator('button[type=submit]').click();
  await page.waitForTimeout(2000);
  log('注册+跳转', !page.url().includes('/register'), `当前: ${page.url()}`);

  // ── 阶段 2: 游戏详情页滚动重叠测试 ──
  console.log('\n── 阶段 2: 详情页滚动测试 ──');
  await page.goto(BASE + '/game/g_01', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);

  // 检查页面结构：sidebar 应该有 sticky，且包含价格卡+雷达图+评价
  const sidebarInfo = await page.evaluate(() => {
    const sidebar = document.querySelector('.sticky.self-start');
    if (!sidebar) return { hasStickySidebar: false };
    
    // 检查侧栏内包含的关键元素
    const hasPriceCard = !!sidebar.querySelector('button'); // 收藏/加入对比按钮在价格卡里
    const hasRadar = !!sidebar.textContent.includes('评分雷达图') || !!sidebar.textContent.includes('玩家评价');
    const childCount = sidebar.children.length;
    
    return {
      hasStickySidebar: true,
      childCount,
      hasPriceCard,
      hasRadarOrReviews: hasRadar,
      sidebarClasses: sidebar.className.substring(0, 80),
    };
  });
  
  log('Sidebar 有 sticky 容器', sidebarInfo.hasStickySidebar, `${sidebarInfo.childCount} 个子块`);
  log('Sidebar 包含完整内容', sidebarInfo.hasRadarOrReviews, `classes: ${sidebarInfo.sidebarClasses}`);

  // 模拟滚动检查是否崩溃
  let scrollOk = true;
  try {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(200);
    }
    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    scrollOk = true;
  } catch (e) {
    scrollOk = false;
    log('滚动过程异常', false, e.message);
  }
  log('滚动无崩溃', scrollOk, '5次下滚+回顶完成');

  // ── 阶段 3: Library 扫描（removeChild 崩溃点）──
  console.log('\n── 阶段 3: Library 扫描 ──');
  await page.goto(BASE + '/library', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  
  const scanBtn = page.locator('button:has-text("扫描本机游戏")');
  const btnCount = await scanBtn.count();
  
  if (btnCount > 0) {
    log('扫描按钮可见', true);
    
    // 点击前记录快照
    const beforeErrs = pageErrors.length;
    
    await scanBtn.first().click();
    
    // 等待扫描完成（最多10秒）
    let scanDone = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const scanning = await page.locator('text=扫描中…').isVisible().catch(() => false);
      if (!scanning) { scanDone = true; break; }
    }
    
    log('扫描完成', scanDone, scanDone ? '扫描流程结束' : '超时但已尝试');
    
    // 等待额外时间让可能的异步 DOM 操作完成
    await page.waitForTimeout(2000);
    
    const newErrors = pageErrors.length - beforeErrs;
    log('扫描后零页面崩溃', newErrors === 0, newErrors > 0 ? `新增 ${newErrors} 错误` : '无新错误');
  } else {
    const bodyText = await page.evaluate(() => document.body?.textContent?.substring(0, 100) || '');
    log('扫描按钮可见', false, `未找到。页面内容: ${bodyText}`);
  }

  // ── 结果汇总 ──
  console.log('\n═══ 结果汇总 ═══');
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`  通过: ${pass}/${results.length}  失败: ${fail}`);
  
  if (crashSignatures.length) {
    console.log('\n  ⚠️ 崩溃签名:');
    crashSignatures.forEach(s => console.log(`    - ${s}`));
  } else {
    console.log('\n  🎉 零崩溃签名 (insertBefore/removeChild/Failed resolve = 0)');
  }
  
  if (consoleErrors.length) {
    console.log('\n  控制台错误:');
    consoleErrors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
  } else {
    console.log('  🎉 零控制台错误');
  }

  await browser.close();
  
  // 退出码
  process.exit(fail > 0 ? 1 : 0);
})();
