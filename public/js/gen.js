'use strict';

// AI 轻应用独立页（#/gen）：为「零基础高中生」重新设计的正向主流程。
// 打开只看到「描述想法 → 开始生成」，示例灵感在下方；多作品草稿、模型选择、生成过程的实时代码
// 都收进次要入口（页头按钮 / 设置 / 折叠区），避免专业术语和复杂概念吓到新手。
// 后端 5 槽（gen_slots / gen_versions）逻辑不变，仅重构前端呈现；DOM id 保持稳定以复用既有绑定。
window.Views = window.Views || {};
Views.gen = () => {
  const { escapeHtml, formatSize, formatTime, confirm, toast, openModal, closeModal } = Utils;

  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">✨ AI 轻应用 <span style="font-size:13px;font-weight:400;color:var(--text-dim);">· 一句话生成小程序</span></h1>
        <div class="page-sub">一句话，AI 帮你做出想玩的小程序（AI 小学堂第2章）</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">
          <span id="gen-quota" style="font-size:12px;color:var(--text-dim);">次数统计中…</span>
          <span style="flex:1;"></span>
          <button class="btn btn-sm btn-outline" id="gen-works-btn" type="button">🗂 我的创作</button>
          <button class="btn btn-sm btn-outline" id="gen-settings-btn" type="button">⚙ 设置</button>
          <button class="btn btn-sm btn-outline" id="gen-back-btn" type="button">← 返回我的项目</button>
        </div>
      </div>

      <!-- 步骤指示器 -->
      <div class="gen-steps">
        <div class="gen-step active" data-step="1"><span class="gen-step-num">1</span>描述想法</div>
        <span class="gen-step-arrow">→</span>
        <div class="gen-step" data-step="2"><span class="gen-step-num">2</span>AI 创作</div>
        <span class="gen-step-arrow">→</span>
        <div class="gen-step" data-step="3"><span class="gen-step-num">3</span>拿走你的作品</div>
      </div>

      <!-- Step 1：描述想法（仅输入 + 开始生成 + 灵感示例） -->
      <div class="gen-phase active" id="gen-phase-1">
        <div class="card">
          <h2 style="margin:0 0 12px;font-size:18px;">描述你想做的小程序</h2>
          <textarea id="gen-idea" rows="4" maxlength="500" placeholder="例如：做一个贪吃蛇小游戏，方向键控制，吃食物变长…" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:12px;font-size:15px;resize:vertical;line-height:1.6;"></textarea>
          <div id="gen-hint" style="font-size:12px;color:var(--text-dim);margin-top:6px;line-height:1.7;"></div>
          <div style="margin-top:12px;">
            <button class="btn btn-primary btn-lg" id="gen-start-btn" type="button" style="width:100%;justify-content:center;">✨ 开始生成</button>
          </div>
          <div class="form-error" id="gen-error"></div>

          <!-- 灵感示例：点击填入 -->
          <div style="margin-top:18px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
              <span style="display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--text-dim);">${Icons.icon('gift', 15)} 没想法？点一个：</span>
              <span style="flex:1;"></span>
              <button class="btn btn-sm btn-ghost" id="gen-examples-refresh" type="button" title="换一批灵感">${Icons.icon('refresh', 15)} 换一批</button>
            </div>
            <div id="gen-examples" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
          </div>
        </div>
      </div>

      <!-- Step 2：AI 创作（大加载卡，代码默认折叠） -->
      <div class="gen-phase" id="gen-phase-2">
        <div class="card">
          <div class="gen-generating-bar"><span class="gen-spinner"></span><span id="gen-generating-label">AI 正在为你创作小程序…</span></div>
          <div style="font-size:13px;color:var(--text-dim);line-height:1.9;margin-bottom:12px;">生成需要一点时间，请耐心等待。</div>
          <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-ghost" id="gen-cancel-btn" type="button">← 修改描述</button>
          </div>
          <details id="gen-log-box">
            <summary style="font-size:12.5px;cursor:pointer;color:var(--text-dim);padding:4px 0;">▸ 查看创作过程</summary>
            <textarea id="gen-log" rows="8" readonly placeholder="" style="width:100%;margin-top:6px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;font-size:12px;font-family:monospace;color:var(--text-dim);background:var(--bg);resize:vertical;overflow-y:auto;line-height:1.5;"></textarea>
          </details>
          <div class="form-error" id="gen-error-2"></div>
        </div>
      </div>

      <!-- Step 3：拿走你的作品（大预览 + 标题 + 提交/重新生成 + 历史版本） -->
      <div class="gen-phase" id="gen-phase-3">
        <div class="card" id="gen-preview-inline">
          <h2 style="margin:0 0 12px;font-size:18px;">🎉 你的作品</h2>
          <div id="gen-preview-placeholder" class="gen-preview-placeholder">
            <span style="font-size:42px;">🤖</span>
            <div style="font-size:14px;font-weight:600;">生成结果将在这里展示</div>
            <div style="font-size:12px;line-height:1.9;">满意后起个名字并提交</div>
          </div>
          <iframe id="gen-preview-frame" class="gen-preview-frame" sandbox="allow-scripts allow-modals" style="display:none;"></iframe>
          <div class="form-error" id="gen-commit-error"></div>
          <div id="gen-preview-actions" style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
            <input id="gen-title" type="text" maxlength="100" placeholder="给你的作品起个名字" style="flex:1;min-width:180px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
            <button class="btn btn-ghost" id="gen-regen" type="button">↻ 改一改</button>
            <button class="btn btn-primary" id="gen-commit" type="button">✅ 我要提交</button>
          </div>

          <!-- 对话记录（版本链时间线） -->
          <details id="gen-history-box" style="display:none;margin-top:14px;border:1px solid var(--border);border-radius:10px;padding:8px 12px;">
            <summary style="font-size:13px;cursor:pointer;color:var(--text-dim);display:flex;align-items:center;gap:8px;padding:4px 0;">💬 对话记录<span id="gen-slot-clear" class="btn btn-sm btn-ghost" style="padding:1px 8px;margin-left:auto;color:var(--danger);" role="button">清空对话记录</span></summary>
            <div id="gen-history" style="max-height:180px;overflow-y:auto;font-size:12.5px;line-height:1.9;"></div>
          </details>
        </div>
      </div>

      <!-- 我的 AI 轻应用（已提交的站内生成作品） -->
      <div class="card" id="gen-myworks-card" style="display:none;margin-top:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <h2 style="margin:0;font-size:15px;">我的 AI 轻应用</h2>
          <span style="font-size:12px;color:var(--text-dim);">已提交 · 展示于全校作品展</span>
        </div>
        <div id="gen-myworks-list"></div>
      </div>
    </div>`;

  // ---- ✨ 一句话生成小程序（逻辑从 dashboard.js Views.files 搬运，面向新手重组） ----
  // 50 个灵感：全部是「一句话能生成的小程序」，适合高中生。每次随机展示 1-2 个，可刷新换一批。
  const GEN_EXAMPLES = [
    '做一个 5 以内加减法答题小游戏，每轮 5 题，答对加 1 分',
    '做一个石头剪刀布游戏，和电脑对战，显示比分',
    '做一个单位换算器，支持长度/重量/温度互换',
    '做一个随机点名器，输入名单后随机抽人',
    '做一个猜数字游戏，电脑想 1-100 的数，你猜，提示大了或小了',
    '做一个乘法口诀练习游戏，随机出题，测速度',
    '做一个倒计时器，设定时间，到点提醒',
    '做一个计分板，两个队伍加分减分',
    '做一个掷骰子模拟器，点击骰子随机 1-6 点',
    '做一个翻牌记忆游戏，翻两张一样的消失',
    '做一个幸运大转盘，点击转出随机奖项',
    '做一个随机抽签器，输入选项随机抽一个',
    '做一个 BMI 计算器，输入身高体重算 BMI 并给建议',
    '做一个日期计算器，两个日期之间相隔几天',
    '做一个年龄计算器，输入生日算周岁',
    '做一个简单记账本，记录收支并汇总',
    '做一个待办事项清单，可添加、勾选、删除',
    '做一个密码生成器，生成随机强密码',
    '做一个色盘取色器，显示 RGB/十六进制色值',
    '做一个二维码文字生成器（显示字符画的简版）',
    '做一个弹球小游戏，鼠标操控挡板反弹小球',
    '做一个打地鼠小游戏，限时看打中多少',
    '做一个反应速度测试，变绿就点击，测反应时间',
    '做一个记忆数字游戏，记住后复述',
    '做一个九宫格拼图游戏，打乱还原',
    '做一个单词默写小工具，中文提示填英文',
    '做一个数学口算挑战，随机加减乘除限时',
    '做一个星座配对小测试，选生日看缘分',
    '做一个心情日记，记录每天心情并做折线图',
    '做一个番茄钟，专注 25 分钟休息 5 分钟',
    '做一个抽奖器，点击从名单里随机抽幸运儿',
    '做一个比大小游戏，两张牌比大小',
    '做一个二十一点小游戏，要牌或停牌',
    '做一个见缝插针游戏，点击放针不能碰到',
    '做一个消消乐小游戏，三个相同消掉',
    '做一个连连看小游戏，连线消除',
    '做一个成语接龙小工具，给提示猜成语',
    '做一个课表查看器，输入课程显示当天的课',
    '做一个值日表，自动排每周值日',
    '做一个考试倒计时，距期末还有几天',
    '做一个音乐节拍器，点击打节拍并计时',
    '做一个随机运动挑战生成器，随机推荐一组动作',
    '做一个猜谜语小游戏，揭晓答案',
    '做一个脑筋急转弯小工具，随机出题看答案',
    '做一个视力自测表，显示字母方向判断视力',
    '做一个手电筒模拟，白屏常亮（夜间用）',
    '做一个便签纸，写一句话生成一张美观便签可下载',
    '做一个生日贺卡生成器，输入祝福生成卡片',
    '做一个星座运势小测试，选星座看今日运势',
    '做一个加油打气机，点击随机一句正能量的话',
  ];
  const DEFAULT_MODEL = 'inkling'; // 默认 Inkling 975B（新手不用碰设置）

  // 返回我的项目
  const backBtn = document.getElementById('gen-back-btn');
  if (backBtn) backBtn.onclick = () => { location.hash = '#/files'; };

  function initGenApp() {
    const ideaEl = document.getElementById('gen-idea');
    const btn = document.getElementById('gen-start-btn');
    const errEl = document.getElementById('gen-error');
    const hintEl = document.getElementById('gen-hint');
    const logEl = document.getElementById('gen-log');
    const genErr2 = document.getElementById('gen-error-2');
    const cancelBtn = document.getElementById('gen-cancel-btn');
    const genLabel = document.getElementById('gen-generating-label');
    if (!btn || !ideaEl) return;

    // ---- 状态：当前作品草稿 / 各草稿版本链 ----
    let curSlot = 1;
    let slotsData = {};
    let activeAbort = null;
    let waitTimer = null;
    let intentionalAbort = false;
    let curPreviewVersionId = null;
    let draftToken = '';
    let currentStep = 1;
    let curModel = DEFAULT_MODEL;

    try { const sv = parseInt(localStorage.getItem('gen_slot'), 10); if (sv >= 1 && sv <= 5) curSlot = sv; } catch (_) {}
    try { const m = localStorage.getItem('gen_model'); if (m) curModel = m; } catch (_) {}

    // ---- 三步步骤指示器 ----
    function setStep(n) {
      currentStep = n;
      document.querySelectorAll('.gen-step').forEach((el) => {
        const s = parseInt(el.dataset.step, 10);
        el.classList.toggle('active', s === n);
        el.classList.toggle('done', s < n);
      });
      document.querySelectorAll('.gen-phase').forEach((el) => {
        el.classList.toggle('active', el.id === 'gen-phase-' + n);
      });
    }

    // ---- 灵感示例：点击填入描述框 ----
    const examplesEl = document.getElementById('gen-examples');
    const examplesRefresh = document.getElementById('gen-examples-refresh');
    // 从 50 个灵感里随机取 1-2 个展示（避免连续重复）
    let lastExampleIdx = -1;
    function showExamples() {
      if (!examplesEl) return;
      const count = Math.random() < 0.5 ? 1 : 2; // 随机 1 或 2 个
      const idxs = [];
      const maxAttempt = GEN_EXAMPLES.length * 3;
      for (let a = 0; a < maxAttempt && idxs.length < count; a++) {
        const i = Math.floor(Math.random() * GEN_EXAMPLES.length);
        if (i === lastExampleIdx) continue;
        if (idxs.indexOf(i) >= 0) continue;
        idxs.push(i);
      }
      lastExampleIdx = idxs.length ? idxs[idxs.length - 1] : -1;
      examplesEl.innerHTML = idxs.map((i) => `<button class="btn btn-sm btn-ghost" type="button" data-ex="${escapeHtml(GEN_EXAMPLES[i])}">${escapeHtml(GEN_EXAMPLES[i])}</button>`).join('');
      examplesEl.querySelectorAll('[data-ex]').forEach((b) => {
        b.onclick = () => {
          ideaEl.value = b.dataset.ex;
          if (hintEl) hintEl.textContent = '';
          ideaEl.focus();
        };
      });
    }
    showExamples();
    if (examplesRefresh) examplesRefresh.onclick = showExamples;

    // ---- 设置浮层：模型选择（默认隐藏，收进 ⚙ 设置） ----
    const settingsBtn = document.getElementById('gen-settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        const selId = 'gen-settings-model';
        openModal(`
          <h3 class="modal-title">⚙ 设置</h3>
          <div style="font-size:13px;line-height:1.9;">
            <div style="margin-bottom:8px;"><strong>生成模型</strong><br><span style="font-size:12px;color:var(--text-dim);">保持默认即可，想换再选。</span></div>
            <select id="${selId}" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:10px;font-size:14px;background:var(--surface);">
              <option value="">加载中…</option>
            </select>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" id="gen-settings-ok">知道了</button></div>`);
        const sel = document.getElementById(selId);
        fillModelSelect(sel, () => {
          curModel = sel.value || DEFAULT_MODEL;
          try { localStorage.setItem('gen_model', curModel); } catch (_) {}
        });
        document.getElementById('gen-settings-ok').onclick = closeModal;
      };
    }

    // 填充模型下拉（按「无限/有限」分层），onChange 存 curModel
    function fillModelSelect(sel, onChange) {
      const d = window.__genModelsCache;
      if (!d) { sel.innerHTML = '<option>请设置后重试</option>'; return; }
      const models = d.models || [];
      const quota = d.quota || {};
      const tierOrder = ['unlimited', 'quota'];
      const tierTitle = { unlimited: '无限免费层', quota: '有限免费层' };
      // 先清空，用当前选中填充
      sel.innerHTML = '';
      for (const t of tierOrder) {
        const tierModels = models.filter((m) => m.tier === t);
        if (!tierModels.length) continue;
        const g = document.createElement('optgroup');
        g.label = tierTitle[t] || t;
        const quotaEmpty = (t === 'quota' && (quota.remaining !== undefined ? quota.remaining <= 0 : false));
        for (const m of tierModels) {
          const o = document.createElement('option');
          o.value = m.id;
          o.textContent = quotaEmpty ? (m.label + '（今日已用完）') : m.label;
          o.disabled = quotaEmpty;
          g.appendChild(o);
        }
        sel.appendChild(g);
      }
      if (sel.querySelector(`option[value="${curModel}"]`)) sel.value = curModel;
      else if (sel.querySelector('option[value="' + DEFAULT_MODEL + '"]')) sel.value = DEFAULT_MODEL;
      else if (sel.firstElementChild) sel.value = sel.firstElementChild.value;
      sel.onchange = onChange;
    }

    // ---- 我的创作（多作品草稿）浮层：页头「🗂 我的创作」按钮 ----
    const worksBtn = document.getElementById('gen-works-btn');
    if (worksBtn) {
      worksBtn.onclick = () => {
        const listId = 'gen-works-list';
        openModal(`
          <h3 class="modal-title">🗂 我的创作 <span style="font-size:12px;color:var(--text-dim);font-weight:400;">· 多个作品</span></h3>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;line-height:1.7;">点击切换要编辑的作品。</div>
          <div id="${listId}" class="gen-work-list" style="max-height:320px;overflow-y:auto;"></div>
          <div class="modal-actions"><button class="btn" id="gen-works-close">关闭</button></div>`);
        renderWorksList(document.getElementById(listId));
        document.getElementById('gen-works-close').onclick = closeModal;
      };
    }

    // 渲染「我的创作」草稿卡片
    function renderWorksList(box) {
      if (!box) return;
      box.innerHTML = '';
      for (let n = 1; n <= 5; n++) {
        const d = slotsData[n] || { versions: [] };
        const vers = d.versions || [];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'gen-work-card' + (n === curSlot ? ' active' : '') + (!vers.length ? ' empty' : '');
        if (vers.length) {
          const latest = vers[0] && vers[0].idea ? vers[0].idea : '（未命名作品）';
          card.innerHTML = `<div class="gwc-title"></div><div class="gwc-meta"></div>${n === curSlot ? '<span class="gwc-tag">正在编辑</span>' : ''}`;
          card.querySelector('.gwc-title').textContent = latest.slice(0, 40);
          card.querySelector('.gwc-meta').textContent = '版本 ' + vers.length + ' · 更新于 ' + formatTime(vers[0].created_at);
          card.title = latest;
        } else {
          card.innerHTML = `<span class="gwc-plus">＋</span><span class="gwc-empty-text">新建一个作品</span>`;
        }
        card.onclick = () => { switchSlot(n); closeModal(); };
        box.appendChild(card);
      }
    }

    // 清空当前草稿的对话记录
    function bindClearSlot() {
      const clearBtn = document.getElementById('gen-slot-clear');
      if (!clearBtn || clearBtn.dataset.bound) return;
      clearBtn.dataset.bound = '1';
      clearBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const vers = (slotsData[curSlot] || {}).versions || [];
        if (!vers.length) { toast('这份作品还没有对话记录'); return; }
        openModal(`
          <h3 class="modal-title">清空这份作品的对话记录</h3>
          <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;">将删除这份作品的 ${vers.length} 个历史版本与对话记录，不影响已提交的作品。确定清空？</p>
          <div class="modal-actions">
            <button class="btn" id="gen-clear-cancel">取消</button>
            <button class="btn" id="gen-clear-ok" style="background:var(--danger);color:#fff;">确认清空</button>
          </div>`);
        document.getElementById('gen-clear-cancel').onclick = closeModal;
        document.getElementById('gen-clear-ok').onclick = async () => {
          try {
            await API.post('/api/gen/slots/' + curSlot + '/clear', '{}');
            draftToken = '';
            logEl.value = '';
            if (genErr2) { genErr2.classList.remove('show'); genErr2.textContent = ''; }
            resetPreview();
            setStep(1);
            closeModal();
            await refreshSlots();
            toast('已清空这份作品的对话记录');
          } catch (err) {
            closeModal();
            toast(err.message || '清空失败');
          }
        };
      };
    }

    // 加载模型列表与今日次数（缓存到 window 供设置浮层用）
    async function loadGenModelsAndQuota() {
      const el = document.getElementById('gen-quota');
      try {
        const d = await API.get('/api/gen/models');
        window.__genModelsCache = d;
        const quota = d.quota || {};
        if (el) {
          const left = (quota.remaining !== undefined) ? quota.remaining : (quota.max_per_day - quota.used_today);
          el.textContent = (d.unlimited !== false)
            ? `今日已生成 ${d.used_today || 0} 次 · 无限层不限次 · 有限层剩 ${Math.max(0, left)}/${quota.max_per_day} 次`
            : `今天还可生成 ${Math.max(0, left)}/${quota.max_per_day} 次`;
        }
      } catch (_) {
        if (el) el.textContent = '次数统计中…';
      }
    }
    loadGenModelsAndQuota();
    bindClearSlot();
    refreshSlots();
    resetPreview();
    setStep(1);

    async function refreshSlots() {
      try {
        const data = await API.get('/api/gen/slots');
        slotsData = {};
        for (const sl of data.slots) slotsData[sl.slot_no] = sl;
      } catch (_) {}
      renderHistory();
      bindClearSlot();
      // 若「我的创作」浮层开着，刷新里面的列表
      const openList = document.getElementById('gen-works-list');
      if (openList) renderWorksList(openList);
    }

    function renderHistory() {
      const box = document.getElementById('gen-history-box');
      const list = document.getElementById('gen-history');
      if (!box || !list) return;
      const vers = (slotsData[curSlot] || {}).versions || [];
      if (!vers.length) { box.style.display = 'none'; list.innerHTML = ''; return; }
      box.style.display = '';
      list.innerHTML = vers.map((v) => `
        <div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
          <span style="color:${v.id === curPreviewVersionId ? 'var(--primary)' : 'inherit'};flex-shrink:0;font-weight:600;">v${v.seq}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(v.idea)}">${escapeHtml(v.idea)}</span>
          <span style="color:var(--text-dim);flex-shrink:0;">${formatTime(v.created_at)}</span>
          <button class="btn btn-sm btn-ghost" data-vprev="${v.id}" style="padding:1px 8px;flex-shrink:0;">预览</button>
        </div>`).join('');
      list.querySelectorAll('[data-vprev]').forEach((b) => {
        b.onclick = () => previewHistoryVersion(parseInt(b.dataset.vprev, 10));
      });
    }

    function switchSlot(n) {
      if (n === curSlot) return;
      curSlot = n;
      try { localStorage.setItem('gen_slot', String(n)); } catch (_) {}
      if (activeAbort) { intentionalAbort = true; try { activeAbort.abort(); } catch (_) {} activeAbort = null; }
      clearInterval(waitTimer);
      draftToken = '';
      curPreviewVersionId = null;
      logEl.value = '';
      if (genErr2) { genErr2.classList.remove('show'); genErr2.textContent = ''; }
      errEl.classList.remove('show');
      resetPreview();
      setStep(1);
      renderHistory();
    }

    // 回看历史版本：签发短时令牌 → iframe 加载（只读）
    async function previewHistoryVersion(vid) {
      try {
        const d = await API.get('/api/gen/version/' + vid + '/token');
        curPreviewVersionId = vid;
        showInlinePreview(d.preview_url, false);
        renderHistory();
        setStep(3);
        const v = (slotsData[curSlot].versions.find((x) => x.id === vid) || {});
        if (hintEl) hintEl.textContent = '👁 正在预览历史版本 v' + v.seq;
      } catch (err) { toast(err.message || '预览失败'); }
    }

    // 重置预览区：隐藏 iframe、恢复占位
    function resetPreview() {
      const frame = document.getElementById('gen-preview-frame');
      const ph = document.getElementById('gen-preview-placeholder');
      if (frame) { frame.style.display = 'none'; frame.src = 'about:blank'; }
      if (ph) ph.style.display = '';
      const actionRow = document.getElementById('gen-preview-actions');
      if (actionRow) actionRow.style.display = 'none';
      const titleInput = document.getElementById('gen-title');
      if (titleInput) titleInput.style.display = 'none';
      const commitErr = document.getElementById('gen-commit-error');
      if (commitErr) { commitErr.classList.remove('show'); commitErr.textContent = ''; }
    }

    function showInlinePreview(previewUrl, showActions = true) {
      const box = document.getElementById('gen-preview-inline');
      if (!box) return;
      const frame = document.getElementById('gen-preview-frame');
      const ph = document.getElementById('gen-preview-placeholder');
      if (frame) { frame.style.display = ''; frame.src = previewUrl; }
      if (ph) ph.style.display = 'none';
      const actionRow = document.getElementById('gen-preview-actions');
      if (actionRow) actionRow.style.display = showActions ? '' : 'none';
      const titleInput = document.getElementById('gen-title');
      if (titleInput) titleInput.style.display = showActions ? '' : 'none';
      bindPreviewActions();
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    ideaEl.addEventListener('focus', () => {
      if (!ideaEl.value && hintEl) hintEl.textContent = '💡 没想法点下方示例即可';
    });

    // 放弃生成，回到 Step1
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        if (activeAbort) { intentionalAbort = true; try { activeAbort.abort(); } catch (_) {} activeAbort = null; }
        clearInterval(waitTimer);
        logEl.value = '';
        if (genErr2) { genErr2.classList.remove('show'); genErr2.textContent = ''; }
        btn.disabled = false;
        btn.textContent = '✨ 开始生成';
        if (hintEl && hintEl.textContent.startsWith('⏳')) hintEl.textContent = '';
        setStep(1);
        ideaEl.focus();
      };
    }

    btn.onclick = async () => {
      errEl.classList.remove('show');
      const idea = ideaEl.value.trim();
      if (!idea) { errEl.textContent = '请先用一句话描述你想做的小程序'; errEl.classList.add('show'); return; }
      btn.disabled = true;
      btn.textContent = '⏳ AI 正在创作…';
      if (hintEl) hintEl.textContent = '已开始生成，看下一步';
      logEl.value = '';
      if (genErr2) { genErr2.classList.remove('show'); genErr2.textContent = ''; }
      resetPreview();
      setStep(2);
      if (genLabel) genLabel.textContent = 'AI 正在为你创作…';
      let draftTokenNew = '';
      try {
        const controller = new AbortController();
        activeAbort = controller;
        const mid = curModel || DEFAULT_MODEL;
        const timeoutMs = (mid === 'sdu-deepseek') ? 900000 : 240000;
        const timeoutMinutes = Math.round(timeoutMs / 60000);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const t0 = Date.now();
        waitTimer = setInterval(() => {
          logEl.value = '⏳ 已等待 ' + Math.round((Date.now() - t0) / 1000) + ' 秒（最长约 ' + timeoutMinutes + ' 分钟）';
        }, 1000);

        const res = await fetch('/api/gen/app/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API.getToken() },
          body: JSON.stringify({ idea, model: mid, slot_no: curSlot }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok || !res.body) {
          clearInterval(waitTimer);
          let msg = '生成失败，请稍后再试';
          try { msg = (await res.json()).error || msg; } catch (_) {}
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamErr = null;
        let sawContent = false;
        let contentAcc = '';
        let gotFirstDelta = false;
        const LOG_MAX = 50000;
        let scrollPending = false;
        const scheduleScroll = () => {
          if (scrollPending) return;
          scrollPending = true;
          requestAnimationFrame(() => {
            scrollPending = false;
            logEl.scrollTop = logEl.scrollHeight;
          });
        };
        const truncate = () => {
          if (logEl.value.length > LOG_MAX) {
            logEl.value = '…（输出过长，已截断，仅显示最近一段）\n' + logEl.value.slice(-LOG_MAX);
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!chunk.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(chunk.slice(5).trim());
              if (ev.type === 'delta') {
                if (!gotFirstDelta) { gotFirstDelta = true; clearInterval(waitTimer); }
                if (ev.reasoning) {
                  logEl.value += ev.text;
                  contentAcc = '';
                } else {
                  contentAcc += ev.text;
                  const pos = contentAcc.search(/<html[\s>]|<!doctype/i);
                  if (!sawContent && pos >= 0) { logEl.value = ''; sawContent = true; if (genLabel) genLabel.textContent = 'AI 已开始创作，请稍候…'; }
                  logEl.value += ev.text;
                }
                truncate();
                scheduleScroll();
              } else if (ev.type === 'error') {
                streamErr = new Error(ev.message || '生成失败');
                if (ev.code === 'model_unavailable') { streamErr.modelUnavailable = true; streamErr.suppress = true; }
              } else if (ev.type === 'done') {
                draftTokenNew = ev.draft_token;
                try { localStorage.setItem('gen_slot_used', '1'); } catch (_) {}
                loadGenModelsAndQuota();
              }
            } catch (_) {}
          }
        }
        if (streamErr) {
          if (streamErr.modelUnavailable) {
            if (genErr2) { genErr2.innerHTML = '⚠️ <strong>该模型暂不可用，请更换模型。</strong>（免费模型高峰期限流，稍后可再试或选其它模型）'; genErr2.classList.add('show'); }
            toast('⚠️ 该模型暂不可用，请更换其它模型');
          }
          const e2 = new Error(streamErr.message);
          e2.suppress = !!streamErr.suppress;
          throw e2;
        }
        if (!draftTokenNew) throw new Error('生成中断，请重试');
        draftToken = draftTokenNew;
        await refreshSlots();
        showInlinePreview('/api/gen/preview/' + encodeURIComponent(draftToken));
        bindPreviewActions();
        setStep(3);
        if (hintEl) hintEl.textContent = '✅ 已生成 v' + ((slotsData[curSlot] || {}).versions[0] || {}).seq + '，可以提交了';
      } catch (err) {
        clearInterval(waitTimer);
        const intentional = intentionalAbort && err && err.name === 'AbortError';
        intentionalAbort = false;
        if (!intentional && !(err && err.suppress)) {
          const msg = (err && err.name === 'AbortError') ? '请求超时，请重试' : (err.message || '生成失败，请稍后再试');
          errEl.textContent = msg;
          errEl.classList.add('show');
          if (genErr2) { genErr2.textContent = ''; genErr2.classList.remove('show'); }
        }
        setStep(1);
      } finally {
        clearInterval(waitTimer);
        activeAbort = null;
        btn.disabled = false;
        btn.textContent = '✨ 开始生成';
        if (hintEl && hintEl.textContent.startsWith('⏳')) hintEl.textContent = '';
      }
    };

    // 预览操作区（改一改=回到输入步；提交=提交当前草稿）
    function bindPreviewActions() {
      const regenBtn = document.getElementById('gen-regen');
      const commitBtn = document.getElementById('gen-commit');
      if (!regenBtn || !commitBtn) return;
      regenBtn.onclick = () => {
        if (draftToken) API.del('/api/gen/draft/' + encodeURIComponent(draftToken)).catch(() => {});
        if (activeAbort) { intentionalAbort = true; try { activeAbort.abort(); } catch (_) {} activeAbort = null; }
        clearInterval(waitTimer);
        draftToken = '';
        resetPreview();
        setStep(1);
        ideaEl.focus();
        if (hintEl) hintEl.textContent = '↻ 改好描述再点「开始生成」';
      };
      commitBtn.onclick = async () => {
        const commitErr = document.getElementById('gen-commit-error');
        const titleEl = document.getElementById('gen-title');
        commitErr.classList.remove('show');
        const title = (titleEl ? titleEl.value : '').trim();
        if (!title) { commitErr.textContent = '请先给你的作品起个名字'; commitErr.classList.add('show'); return; }
        commitBtn.disabled = true;
        commitBtn.textContent = '提交中…';
        try {
          await API.post('/api/gen/commit', JSON.stringify({ draft_token: draftToken, title }));
          resetPreview();
          draftToken = '';
          toast('✅ 作品已提交，可在「我的 AI 轻应用」查看；去 AI 小学堂第2章打卡吧！');
          loadGenWorks();
          setStep(1);
        } catch (err) {
          commitBtn.disabled = false;
          commitBtn.textContent = '✅ 我要提交';
          commitErr.textContent = err.message || '提交失败，请重试';
          commitErr.classList.add('show');
        }
      };
    }
  }
  initGenApp();

  // ---- 我的 AI 轻应用（站内生成并已提交的作品列表） ----
  function renderGenWorks(genWorks) {
    const card = document.getElementById('gen-myworks-card');
    const listEl = document.getElementById('gen-myworks-list');
    if (!card || !listEl) return;
    if (!genWorks.length) { card.style.display = 'none'; listEl.innerHTML = ''; return; }
    card.style.display = '';
    const isHtmlName = (name) => /\.(html?|htm)$/i.test(name || '');
    listEl.innerHTML = genWorks.map((f) => `
      <div class="file-row">
        <div class="file-icon" style="background:#7c5cff;color:#fff;">${Icons.icon('app', 20)}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.title || f.original_name)}</div>
          <div class="file-meta">${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
        </div>
        <div class="file-actions">
          ${isHtmlName(f.original_name) ? `<a class="btn btn-sm btn-primary" href="/preview.html?v=2#/file/${f.id}" target="_blank" rel="noopener">预览</a>` : ''}
          <button class="btn btn-sm btn-ghost" data-gendel="${f.id}" data-name="${escapeHtml(f.title || f.original_name)}" style="color:var(--danger);">删除</button>
        </div>
      </div>`).join('');
    listEl.querySelectorAll('[data-gendel]').forEach((b) => {
      b.onclick = async () => {
        const okDel = await confirm('确定删除「' + b.dataset.name + '」吗？删除后积分将回扣。', { danger: true });
        if (!okDel) return;
        try {
          await API.del('/api/files/' + b.dataset.gendel);
          toast('已删除');
          loadGenWorks();
        } catch (err) { toast(err.message || '删除失败'); }
      };
    });
  }

  async function loadGenWorks() {
    try {
      const data = await API.get('/api/files');
      const files = data.files || [];
      const genWorks = files.filter((f) => f.source === 'gen');
      renderGenWorks(genWorks);
    } catch (_) { /* 静默 */ }
  }

  loadGenWorks();
};
