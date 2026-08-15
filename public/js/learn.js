'use strict';

// 学AI 栏目：教程列表 + 文章详情（轻量 Markdown 渲染，无外部依赖）
window.Views = window.Views || {};

// 阅读计时器通过 window.__cancelLearnReadTimer 由 app.js 在每次路由切换时取消

// 轻量 Markdown → HTML 渲染器（覆盖教程常用语法；先转义再结构化，防 XSS）
function renderMarkdown(md) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const lines = String(md || '').split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  let inCode = false;
  let codeBuf = [];
  let tableBuf = null; // 表格行收集（null = 不在表格中）

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  const closeTable = () => {
    if (tableBuf) {
      out.push(renderTable(tableBuf));
      tableBuf = null;
    }
  };

  // 媒体行（整行图片/视频）：连续行收集，多张并排成一行；单张独立成图
  let mediaBuf = [];
  const isVideoSrc = (src) => /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(src) || src.includes('player.bilibili.com');
  const mediaHtml = (m) => {
    const alt = m[1], src = m[2];
    // 注意：此路径的 alt/src 来自原始 Markdown 行（未先 esc），内插进 HTML 属性前必须转义，
    // 否则 `![x" onerror="...](url)` 可注入事件处理器（与 inline() 先 esc 再替换的路径不同）
    const escAlt = esc(alt), escSrc = esc(src);
    if (src.includes('player.bilibili.com')) {
      return `<iframe class="learn-bili" src="${escSrc}" scrolling="no" frameborder="no" allowfullscreen="true" title="${escAlt}" loading="lazy"></iframe>`
        + (alt ? `<figcaption>${esc(alt)}</figcaption>` : '');
    }
    if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(src)) {
      return `<video src="${escSrc}" controls preload="metadata" title="${escAlt}"></video>`;
    }
    return `<img src="${escSrc}" alt="${escAlt}" loading="lazy" />`
      + (alt ? `<figcaption>${esc(alt)}</figcaption>` : '');
  };
  const flushMedia = () => {
    if (!mediaBuf.length) return;
    const figs = mediaBuf.map((m) => `<figure class="learn-media">${mediaHtml(m)}</figure>`).join('');
    // 视频/内嵌播放器不参与并排（多图才并排成行），保证播放器全宽可看
    const allImg = mediaBuf.every((m) => !isVideoSrc(m[2]));
    out.push(mediaBuf.length > 1 && allImg ? `<div class="learn-img-row">${figs}</div>` : figs);
    mediaBuf = [];
  };

  for (let raw of lines) {
    // 代码块：``` 开关
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        out.push(`<pre class="learn-pre"><code>${esc(codeBuf.join('\n'))}</code><button class="learn-copy-btn" type="button" title="复制">📋 复制</button></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        closeTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const line = raw.trimEnd();

    // 媒体行（整行图片/视频）：收集连续行；非媒体行先冲刷已收集的
    const mediaMatch = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (mediaMatch) {
      closeList();
      closeTable();
      mediaBuf.push(mediaMatch);
      continue;
    }
    if (mediaBuf.length) flushMedia();

    // 表格行：以 | 开头或包含 |（且不是分隔行）→ 收集
    const isTableRow = /^\s*\|.*\|\s*$/.test(line) || (line.includes('|') && !/^\s*[-|:\s]+\s*$/.test(line));
    const isTableSep = /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

    if (tableBuf) {
      if (isTableSep) { continue; } // 跳过表头分隔行
      if (!line.trim() || !isTableRow) { closeTable(); } // 表格结束
      else { tableBuf.push(line); continue; }
    } else {
      if (isTableRow && !isTableSep) {
        closeList();
        tableBuf = [line];
        continue;
      }
    }

    if (!line.trim()) { closeList(); continue; }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      closeTable();
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }

    // 无序/有序列表
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ol ? 'ol' : 'ul';
      if (listType !== tag) { closeList(); listType = tag; out.push(`<${tag}>`); }
      out.push(`<li>${inline((ul ? ul[1] : ol[1]))}</li>`);
      continue;
    }

    // 引用
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    // 水平线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList();
      out.push('<hr />');
      continue;
    }

    // 普通段落
    closeList();
    closeTable();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  if (mediaBuf.length) flushMedia();
  if (inCode) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`);

  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) =>
        /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(src)
          ? `<video src="${src}" controls preload="metadata" title="${alt}"></video>`
          : `<img src="${src}" alt="${alt}" loading="lazy" />`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // 表格渲染：第一行为表头，其余为数据行
  function renderTable(rows) {
    const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '')
      .split('|').map((c) => c.trim());
    const header = cells(rows[0]);
    const body = rows.slice(1).filter((r) => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(r) || !r.includes('-'));
    let html = '<table class="md-table"><thead><tr>';
    html += header.map((h) => `<th>${inline(h)}</th>`).join('');
    html += '</tr></thead><tbody>';
    for (const r of body) {
      html += '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  return out.join('\n');
}

Views.learnList = async () => {
  const { escapeHtml } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">AI 小学堂</h1>
        <div class="page-sub">从认识 AI 到做出作品、发布上线 —— 面向零基础同学的系列教程</div>
      </div>
      <div id="learn-content"><div class="spinner"></div></div>
    </div>`;

  let chapters;
  try {
    const data = await API.get('/api/learn');
    chapters = data.chapters;
  } catch (err) {
    document.getElementById('learn-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const content = document.getElementById('learn-content');
  if (!chapters.length) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">📚</div>教程整理中，敬请期待</div>`;
    return;
  }

  // 学习进度（登录用户；游客返回空）
  let progress = null;
  try { progress = await API.get('/api/learn/progress'); } catch (_) { progress = null; }

  // 章节完成映射：progress.chapters 按 chapter 号平铺（每篇文章即一章），已通关章节置灰
  const progMap = progress && progress.logged_in
    ? new Map((progress.chapters || []).map((p) => [p.chapter, p]))
    : new Map();

  content.innerHTML = `
    <div class="learn-progress-wrap">
      ${renderProgressRail(chapters, progress)}
      <div class="learn-chapters">
        ${chapters.map((c, ci) => `
    <div class="card learn-chapter${progMap.get(c.chapter) && progMap.get(c.chapter).done ? ' done' : ''}">
      <div class="learn-chapter-head">
        <span class="learn-chapter-badge">${progMap.get(c.chapter) && progMap.get(c.chapter).done ? '✓' : c.chapter}</span>
        <div class="learn-chapter-titles">
          <div class="learn-chapter-no">第 ${c.chapter} 章</div>
          <div class="learn-chapter-sub">${progMap.get(c.chapter) && progMap.get(c.chapter).done ? '已通关 · 奖励已到账' : c.articles.length + ' 篇内容 · 通关得 ⭐ 积分'}</div>
        </div>
        <span class="learn-chapter-count">${progMap.get(c.chapter) && progMap.get(c.chapter).done ? '✓ 已通关' : c.articles.length + ' 篇'}</span>
      </div>
      <div class="learn-list">
        ${c.articles.map((a) => `
          <a class="learn-item" href="#/learn/${encodeURIComponent(a.slug)}">
            <div class="learn-item-main">
              <div class="learn-item-title">${escapeHtml(a.title)}</div>
              ${a.summary ? `<div class="learn-item-summary">${escapeHtml(a.summary)}</div>` : ''}
            </div>
            <span class="learn-item-arrow">→</span>
          </a>`).join('')}
      </div>
    </div>`).join('')}
      </div>
    </div>`;
};

// 左侧竖向学习进度条（登录后显示）：节点=章节，完成点亮金，首个未完成标"进行中"
function renderProgressRail(chapters, progress) {
  const { escapeHtml } = Utils;
  if (!progress || !progress.logged_in || !progress.chapters || !progress.chapters.length) return '';
  const progMap = new Map(progress.chapters.map((c) => [c.chapter, c]));
  const firstUndone = progress.chapters.find((c) => !c.done);
  const nodes = chapters.map((c, i) => {
    const p = progMap.get(c.chapter);
    const done = !!(p && p.done);
    const isCurrent = firstUndone && c.chapter === firstUndone.chapter;
    const dot = done ? '✓' : String(c.chapter);
    const state = done ? '已完成' : (isCurrent ? '进行中' : '未完成');
    const title = `第${c.chapter}章 ${p ? p.title : ''}（${state}）`;
    return `<div class="lp-node ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}" title="${escapeHtml(title)}"><span class="lp-dot">${dot}</span></div>`
      + (i < chapters.length - 1 ? '<div class="lp-line"></div>' : '');
  }).join('');
  return `
    <aside class="learn-progress-rail">
      <div class="learn-progress-label">学习进度</div>
      <div class="learn-progress-track">${nodes}</div>
      <div class="learn-progress-num">${progress.completed} / ${progress.total}</div>
    </aside>`;
}

Views.learnArticle = async (slug) => {
  const { escapeHtml, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div id="learn-article"><div class="spinner"></div></div>
    </div>`;

  let article;
  try {
    const data = await API.get('/api/learn/' + encodeURIComponent(slug));
    article = data.article;
  } catch (err) {
    document.getElementById('learn-article').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  document.getElementById('learn-article').innerHTML = `
    <a class="btn btn-sm btn-ghost learn-back" href="#/learn">← 返回目录</a>
    <article class="card learn-article">
      <div class="learn-article-head">
        <div class="learn-article-chapter">第 ${article.chapter} 章</div>
        <h1 class="learn-article-title">${escapeHtml(article.title)}</h1>
        ${article.summary ? `<p class="learn-article-summary">${escapeHtml(article.summary)}</p>` : ''}
      </div>
      <div class="learn-article-body">${renderMarkdown(article.content)}</div>
      ${article.tasks && article.tasks.length ? renderTasks(article.tasks, article.id) : ''}
    </article>`;

  // ---- 阅读计时：在当前文章停留 ≥60s 才上报阅读完成（每篇仅一次，服务端幂等） ----
  // 注意：SPA 切换文章不触发 pagehide/beforeunload，必须显式清理上一篇文章的计时器与监听器
  const READ_MS = 60 * 1000;
  let readReported = false;
  const readStart = Date.now();
  let readTimer = null;
  let readOnLeave = null;

  // 全局取消钩子：app.js 每次路由切换（含 SPA 内跳转）都会调用它，
  // 确保离开文章后计时器立即停止，不会"回到首页才提示阅读完成"
  window.__cancelLearnReadTimer = () => {
    if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    if (readOnLeave) {
      window.removeEventListener('pagehide', readOnLeave);
      window.removeEventListener('beforeunload', readOnLeave);
      readOnLeave = null;
    }
    readReported = true; // 标记已处理，防止任何兜底路径再上报
  };

  // 进入新文章前，先取消可能残留的旧计时器（SPA 内直接换文章的情况）
  if (window.__cancelLearnReadTimer) window.__cancelLearnReadTimer();
  readReported = false; // 新文章重新允许计时

  const reportRead = async () => {
    if (readReported) return;
    readReported = true;
    try {
      const data = await API.post('/api/points/read', JSON.stringify({ article_id: article.id }));
      if (data.granted) {
        toast('⏱ 阅读完成 +' + data.granted + ' ⭐');
        bumpPoints(data.points);
      }
    } catch (_) { /* 静默 */ }
  };
  readTimer = setTimeout(reportRead, READ_MS);

  const onLeave = () => {
    if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    // 离开时若已读够时长且未上报，用 fetch keepalive 兜底（可带 Authorization 头）
    if (!readReported && Date.now() - readStart >= READ_MS) {
      try {
        fetch('/api/points/read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (API.getToken() || ''),
          },
          body: JSON.stringify({ article_id: article.id }),
          keepalive: true,
        }).catch(() => {});
      } catch (_) { /* ignore */ }
    }
  };
  readOnLeave = onLeave;
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  // NFTI 体验任务：查询体验状态（可能自动标记完成）
  initNftiTasks();
  // 第2/3章自动检测任务：发表应用 / 提交项目（可能自动标记完成）
  initAutoTasks();

  // 本章任务进度：回填已完成状态 + 更新进度条
  loadTaskProgress(article.id);

  // 更新本地用户积分（导航栏徽章实时刷新）
  function bumpPoints(total) {
    const u = API.getUser() || {};
    if (total != null) { u.points = total; API.setUser(u); }
    Nav.render();
  }
  window.__bumpPoints = bumpPoints;
};

// 渲染章节任务区
function renderTasks(tasks, articleId) {
  const { escapeHtml } = Utils;
  return `
    <div class="learn-tasks">
      <div class="learn-tasks-head">
        <h2 class="learn-tasks-title">📋 本章任务</h2>
        <span class="learn-tasks-progress" id="learn-tasks-progress">0 / ${tasks.length}</span>
      </div>
      <div class="learn-tasks-bar"><div class="learn-tasks-bar-fill" id="learn-tasks-bar-fill" style="width:0%"></div></div>
      <div class="learn-tasks-hint">完成本章全部 ${tasks.length} 个任务，可领取 20 ⭐ 积分</div>
      ${tasks.map((t, i) => {
        if (t.type === 'action') {
          if (t.nfti) {
            // NFTI 体验任务：需 QQ 登录 → 跳转体验 → 回来判定完成
            return `
              <div class="card learn-task" data-article="${articleId}" data-task="${i}" data-nfti="1">
                <div class="learn-task-badge badge-action">实操</div>
                <div class="learn-task-body">
                  <div class="learn-task-head">${escapeHtml(t.title || '实操任务')}</div>
                  ${t.desc ? `<p class="learn-task-desc">${escapeHtml(t.desc)}</p>` : ''}
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary nfti-go-btn">🚀 去体验 NFTI</button>
                    <button class="btn btn-sm btn-ghost task-done-btn nfti-done-btn">✅ 我已体验完成</button>
                  </div>
                  <div class="nfti-status" style="margin-top:8px;font-size:13px;"></div>
                </div>
              </div>`;
          }
          if (t.appcheck) {
            // 第2章：发表 AI 应用 → 后台检测频道发帖（需 QQ 登录）
            return `
              <div class="card learn-task" data-article="${articleId}" data-task="${i}" data-appcheck="1">
                <div class="learn-task-badge badge-action">实操</div>
                <div class="learn-task-body">
                  <div class="learn-task-head">${escapeHtml(t.title || '实操任务')}</div>
                  ${t.desc ? `<p class="learn-task-desc">${escapeHtml(t.desc)}</p>` : ''}
                  <button class="btn btn-sm btn-primary app-done-btn">📤 我已发表</button>
                  <div class="app-status" style="margin-top:8px;font-size:13px;"></div>
                </div>
              </div>`;
          }
          if (t.projectcheck) {
            // 第3章：提交独立项目文件 → 后台检测上传记录
            return `
              <div class="card learn-task" data-article="${articleId}" data-task="${i}" data-projectcheck="1">
                <div class="learn-task-badge badge-action">实操</div>
                <div class="learn-task-body">
                  <div class="learn-task-head">${escapeHtml(t.title || '实操任务')}</div>
                  ${t.desc ? `<p class="learn-task-desc">${escapeHtml(t.desc)}</p>` : ''}
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <a class="btn btn-sm btn-primary" href="#/files">📦 去「我的项目」上传</a>
                    <button class="btn btn-sm btn-primary project-done-btn">✅ 我已上传</button>
                  </div>
                  <div class="project-status" style="margin-top:8px;font-size:13px;"></div>
                </div>
              </div>`;
          }
          if (t.tinyidcheck) {
            // 第5章：让 Agent 查频道 tiny_id → 填输入框 → 与登录身份核验
            return `
              <div class="card learn-task" data-article="${articleId}" data-task="${i}" data-tinyidcheck="1">
                <div class="learn-task-badge badge-action">实操</div>
                <div class="learn-task-body">
                  <div class="learn-task-head">${escapeHtml(t.title || '实操任务')}</div>
                  ${t.desc ? `<p class="learn-task-desc">${escapeHtml(t.desc)}</p>` : ''}
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <input class="tinyid-input" type="text" inputmode="numeric" autocomplete="off" placeholder="粘贴 Agent 查到的用户 ID（纯数字）" />
                    <button class="btn btn-sm btn-primary tinyid-check-btn">🔍 核验</button>
                  </div>
                  <div class="tinyid-status" style="margin-top:8px;font-size:13px;"></div>
                </div>
              </div>`;
          }
          return `
            <div class="card learn-task" data-article="${articleId}" data-task="${i}">
              <div class="learn-task-badge badge-action">实操</div>
              <div class="learn-task-body">
                <div class="learn-task-head">${escapeHtml(t.title || '实操任务')}</div>
                ${t.desc ? `<p class="learn-task-desc">${escapeHtml(t.desc)}</p>` : ''}
                <button class="btn btn-sm btn-primary task-done-btn">✅ 我完成了</button>
              </div>
            </div>`;
        }
        if (t.type === 'video') {
          return `
            <div class="card learn-task" data-article="${articleId}" data-task="${i}">
              <div class="learn-task-badge badge-video">视频</div>
              <div class="learn-task-body">
                <div class="learn-task-head">${escapeHtml(t.title || '观看视频')}</div>
                ${t.note ? `<p class="learn-task-desc">${escapeHtml(t.note)}</p>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <a class="btn btn-sm btn-primary" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">▶ 去 B 站观看</a>
                  <button class="btn btn-sm btn-ghost task-done-btn">✅ 看完了</button>
                </div>
              </div>
            </div>`;
        }
        if (t.type === 'quiz') {
          return `
            <div class="card learn-task" data-article="${articleId}" data-task="${i}" data-explain="${escapeHtml(t.explain || '')}">
              <div class="learn-task-badge badge-quiz">单选</div>
              <div class="learn-task-body">
                <div class="learn-task-head">${escapeHtml(t.question)}</div>
                <div class="quiz-options" data-answer="${t.answer}">
                  ${t.options.map((o, oi) => `
                    <button class="quiz-option" data-oi="${oi}"><span class="quiz-opt-label">${String.fromCharCode(65 + oi)}.</span> ${escapeHtml(o)}</button>`).join('')}
                </div>
                <div class="quiz-feedback"></div>
              </div>
            </div>`;
        }
        return '';
      }).join('')}
    </div>`;
}

// 上报任务完成：服务端记录；一章全部完成后发整章积分（20 ⭐）
async function reportTask(articleId, taskIndex) {
  try {
    const data = await API.post('/api/points/task', JSON.stringify({ article_id: articleId, task_index: taskIndex }));
    updateTaskProgressUI(articleId, data);
    if (data.granted) {
      Utils.toast('🎉 本章任务全部完成 +' + data.granted + ' ⭐');
      if (window.__bumpPoints) window.__bumpPoints(data.points);
    } else if (data && data.chapter_done) {
      // 已发过整章积分（重复完成）
      Utils.toast('✅ 本章任务已完成');
    }
  } catch (err) {
    // 上报失败要可见，避免"以为完成但没记录"
    Utils.toast('⚠️ 任务记录失败：' + (err && err.message ? err.message : '网络错误'));
    // 回滚前端锁定态，允许重试
    const task = document.querySelector(`.learn-task[data-article="${articleId}"][data-task="${taskIndex}"]`);
    if (task) {
      task.dataset.done = '';
      const btn = task.querySelector('.task-done-btn, .app-done-btn, .project-done-btn, .tinyid-check-btn');
      if (btn) { btn.disabled = false; btn.textContent = '✅ 重试'; btn.classList.remove('task-done'); }
      const tInput = task.querySelector('.tinyid-input');
      if (tInput) tInput.disabled = false;
      const wrap = task.querySelector('.quiz-options');
      if (wrap) wrap.dataset.locked = '';
    }
  }
}

// 更新章节任务进度 UI（进度条 + 数字 + 全完成态）
function updateTaskProgressUI(articleId, data) {
  if (!data) return;
  const bar = document.getElementById('learn-tasks-bar-fill');
  const label = document.getElementById('learn-tasks-progress');
  const hint = document.querySelector('.learn-tasks-hint');
  if (bar) bar.style.width = Math.round((data.done_count / data.total) * 100) + '%';
  if (label) label.textContent = data.done_count + ' / ' + data.total;
  if (hint && data.chapter_done) hint.textContent = '🎉 本章全部任务已完成，积分已到账';
}

// 文章加载：拉取本章任务进度，回填已完成状态
async function loadTaskProgress(articleId) {
  try {
    const data = await API.get('/api/points/task-progress?article_id=' + articleId);
    updateTaskProgressUI(articleId, data);
    const doneSet = new Set((data.progress || []).filter((p) => p.done).map((p) => p.task_index));
    document.querySelectorAll('.learn-task[data-article="' + articleId + '"]').forEach((task) => {
      const ti = parseInt(task.dataset.task, 10);
      if (!doneSet.has(ti)) return;
      // 回填已完成：按钮置灰（除 NFTI 任务的"去体验"按钮仍可点）
      task.dataset.done = '1';
      const doneBtn = task.querySelector('.task-done-btn, .app-done-btn, .project-done-btn, .tinyid-check-btn');
      if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = '✓ 已完成'; doneBtn.classList.add('task-done'); }
      const tInput = task.querySelector('.tinyid-input');
      if (tInput) tInput.disabled = true;
      // 单选：锁定已答对的题（绿色显示）
      const wrap = task.querySelector('.quiz-options');
      if (wrap && !wrap.dataset.locked) {
        wrap.dataset.locked = '1';
        const answer = parseInt(wrap.dataset.answer, 10);
        wrap.querySelectorAll('.quiz-option').forEach((o) => {
          if (parseInt(o.dataset.oi, 10) === answer) o.classList.add('correct');
        });
        const fb = task.querySelector('.quiz-feedback');
        if (fb) { fb.innerHTML = `<span class="quiz-fb-ok">✓ 已完成</span>`; fb.classList.add('show'); }
      }
    });
  } catch (_) { /* 静默 */ }
}

// NFTI 体验任务：文章加载时查询体验状态（已体验则直接标记完成）
async function initNftiTask(task) {
  if (!task || !task.dataset.nfti) return;
  const statusEl = task.querySelector('.nfti-status');
  const user = API.getUser() || {};
  // 未 QQ 登录：提示必须登录
  if (!user.is_qq_bound) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--danger);">⚠️ 该任务需要 QQ 频道登录后才能体验，请先登录</span>`;
    }
    const goBtn = task.querySelector('.nfti-go-btn');
    if (goBtn) {
      goBtn.textContent = '🔑 先登录 QQ 频道';
      goBtn.onclick = () => { API.clearToken(); location.hash = '#/login'; };
    }
    return;
  }
  try {
    const data = await API.get('/api/learn/nfti-status');
    if (data.experienced) {
      // 已有体验记录 → 直接标记完成（按钮仍可点击）
      task.dataset.done = '1';
      const btn = task.querySelector('.task-done-btn');
      if (btn) { btn.disabled = true; btn.textContent = '✓ 已完成'; btn.classList.add('task-done'); }
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 检测到你的 NFTI 测试记录，任务已自动完成</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">完成一次 NFTI 人格测试后，点「我已体验完成」自动核验</span>`;
    }
  } catch (_) { /* 静默 */ }
}

// 去体验 NFTI：签发 ticket 后跳转
document.addEventListener('click', async (e) => {
  const goBtn = e.target.closest('.nfti-go-btn');
  if (!goBtn) return;
  const task = goBtn.closest('.learn-task');
  const statusEl = task ? task.querySelector('.nfti-status') : null;
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">正在生成体验链接…</span>`;
  try {
    const data = await API.get('/api/learn/nfti-ticket');
    window.open(data.url, '_blank');
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">已打开 NFTI，完成测试后回来点「我已体验完成」</span>`;
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">${Utils.escapeHtml(err.message)}</span>`;
  }
});

// NFTI 体验完成：服务端核验 nfti 库是否有测试记录，有才给分
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.nfti-done-btn');
  if (!btn) return;
  const task = btn.closest('.learn-task');
  if (!task || task.dataset.done) return;
  const statusEl = task ? task.querySelector('.nfti-status') : null;
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">正在核验体验记录…</span>`;
  try {
    const data = await API.get('/api/learn/nfti-status');
    if (data.experienced) {
      task.dataset.done = '1';
      btn.disabled = true;
      btn.textContent = '✓ 已完成';
      btn.classList.add('task-done');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 核验通过，体验完成！</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">还没检测到你的 NFTI 测试记录，先去完成一次人格测试吧～</span>`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">${Utils.escapeHtml(err.message)}</span>`;
  }
});

// 文章渲染完成后初始化 NFTI 任务状态
function initNftiTasks() {
  document.querySelectorAll('.learn-task[data-nfti]').forEach((t) => initNftiTask(t));
}

// ---- 第2章发表应用检测（data-appcheck） ----
async function initAppTask(task) {
  if (!task) return;
  const statusEl = task.querySelector('.app-status');
  const user = API.getUser() || {};
  // 未 QQ 登录：提示必须登录
  if (!user.is_qq_bound) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--danger);">⚠️ 需要 QQ 频道登录后发表应用才能检测，请先登录</span>`;
    }
    const btn = task.querySelector('.app-done-btn');
    if (btn) { btn.textContent = '🔑 先登录 QQ 频道'; btn.onclick = () => { API.clearToken(); location.hash = '#/login'; }; }
    return;
  }
  try {
    const data = await API.get('/api/learn/app-status');
    if (data.posted) {
      // 已检测到发帖 → 自动标记完成
      task.dataset.done = '1';
      const btn = task.querySelector('.app-done-btn');
      if (btn) { btn.disabled = true; btn.textContent = '✓ 已完成'; btn.classList.add('task-done'); }
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 检测到你的频道发帖，任务已自动完成</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">发表应用后点「我已发表」，系统自动核验</span>`;
    }
  } catch (_) { /* 静默 */ }
}

// ---- 第3章项目提交检测（data-projectcheck） ----
async function initProjectTask(task) {
  if (!task) return;
  const statusEl = task.querySelector('.project-status');
  try {
    const data = await API.get('/api/learn/project-status');
    if (data.submitted) {
      task.dataset.done = '1';
      const btn = task.querySelector('.project-done-btn');
      if (btn) { btn.disabled = true; btn.textContent = '✓ 已完成'; btn.classList.add('task-done'); }
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 检测到你的项目文件，任务已自动完成</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">上传项目文件后点「我已上传」，系统自动核验</span>`;
    }
  } catch (_) { /* 静默 */ }
}

// 文章渲染完成后初始化第2/3章自动检测任务
function initAutoTasks() {
  document.querySelectorAll('.learn-task[data-appcheck]').forEach((t) => initAppTask(t));
  document.querySelectorAll('.learn-task[data-projectcheck]').forEach((t) => initProjectTask(t));
  document.querySelectorAll('.learn-task[data-tinyidcheck]').forEach((t) => initTinyidTask(t));
}

// 发表应用核验：服务端检测频道发帖，有才给分
async function checkAppPosted(task, btn, statusEl) {
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">正在检测你的发帖与投稿记录…</span>`;
  try {
    const data = await API.get('/api/learn/app-status');
    if (data.posted && data.submitted) {
      task.dataset.done = '1';
      btn.disabled = true;
      btn.textContent = '✓ 已完成';
      btn.classList.add('task-done');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 核验通过，任务完成！</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else if (!data.posted) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">还没检测到你的频道发帖记录。确认已在频道发表？发表后过 1-2 分钟再试～</span>`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">已检测到发帖 ✓，但还没投稿到本站。请到「我的项目」→「AI 轻应用」点「自动识别」，把作品提交上来后再试～</span>`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">${Utils.escapeHtml((err && err.message) || '检测失败，请重试')}</span>`;
  }
}

// 项目提交核验：服务端检测 files 上传记录，有才给分
async function checkProjectSubmitted(task, btn, statusEl) {
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">正在检测你的上传记录…</span>`;
  try {
    const data = await API.get('/api/learn/project-status');
    if (data.submitted) {
      task.dataset.done = '1';
      btn.disabled = true;
      btn.textContent = '✓ 已完成';
      btn.classList.add('task-done');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 核验通过，任务完成！</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">还没检测到你的上传记录。去「我的项目」上传项目文件后，稍等片刻再试～</span>`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">${Utils.escapeHtml((err && err.message) || '检测失败，请重试')}</span>`;
  }
}

// 我已发表（第2章）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.app-done-btn');
  if (!btn) return;
  const task = btn.closest('.learn-task');
  if (!task || task.dataset.done) return;
  checkAppPosted(task, btn, task.querySelector('.app-status'));
});

// 我已上传（第3章）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.project-done-btn');
  if (!btn) return;
  const task = btn.closest('.learn-task');
  if (!task || task.dataset.done) return;
  checkProjectSubmitted(task, btn, task.querySelector('.project-status'));
});

// ---- 第5章 tiny_id 核验任务（data-tinyidcheck） ----
// 初始化：未 QQ 登录时提示并禁用
function initTinyidTask(task) {
  if (!task) return;
  const user = API.getUser() || {};
  if (user.is_qq_bound) return;
  const statusEl = task.querySelector('.tinyid-status');
  const btn = task.querySelector('.tinyid-check-btn');
  const input = task.querySelector('.tinyid-input');
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">⚠️ 需要 QQ 频道登录后才能核验你的身份，请先登录</span>`;
  if (btn) btn.disabled = true;
  if (input) input.disabled = true;
}

// 核验：填的 tiny_id 与登录身份一致 → 任务完成
async function checkTinyId(task, btn, input, statusEl) {
  const value = (input ? input.value : '').trim();
  if (!value) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">先把 Agent 查到的 ID 填进来～</span>`;
    return;
  }
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim);">正在核验…</span>`;
  try {
    const data = await API.post('/api/learn/tinyid-check', JSON.stringify({ tiny_id: value }));
    if (data.match) {
      task.dataset.done = '1';
      btn.disabled = true;
      if (input) input.disabled = true;
      btn.textContent = '✓ 已通过';
      btn.classList.add('task-done');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✓ 核验通过！这就是你的频道身份</span>`;
      reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">✗ 不一致，让 Agent 再查一次（确认是纯数字 ID）</span>`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">${Utils.escapeHtml((err && err.message) || '核验失败，请重试')}</span>`;
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.tinyid-check-btn');
  if (!btn) return;
  const task = btn.closest('.learn-task');
  if (!task || task.dataset.done) return;
  checkTinyId(task, btn, task.querySelector('.tinyid-input'), task.querySelector('.tinyid-status'));
});

// 任务完成打卡（视频看完了 / 实操完成了）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.task-done-btn');
  if (!btn) return;
  const task = btn.closest('.learn-task');
  if (!task || task.dataset.done) return;
  task.dataset.done = '1';
  btn.disabled = true;
  btn.textContent = '✓ 已完成';
  btn.classList.add('task-done');
  reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
});

// 复制按钮：复制代码块内容到剪贴板（clipboard API 不可用时降级 execCommand）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.learn-copy-btn');
  if (!btn) return;
  const pre = btn.closest('pre');
  const code = pre ? pre.querySelector('code').innerText : '';
  const done = () => {
    Utils.toast('📋 提示词已复制');
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = '📋 复制'; }, 1600);
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(code);
      done();
      return;
    }
    throw new Error('clipboard-unavailable');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  }
});

// 图片点击放大（lightbox）：点正文图片全屏查看，点任意处关闭
// 注意：_blank 新开或长按保存不受影响；overlay 内点击不会二次触发
document.addEventListener('click', (e) => {
  const img = e.target.closest('.learn-media img');
  if (!img || img.closest('.img-lightbox')) return;
  const overlay = document.createElement('div');
  overlay.className = 'img-lightbox';
  const large = document.createElement('img');
  large.src = img.currentSrc || img.src;
  large.alt = img.alt || '';
  overlay.appendChild(large);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
});

// 选择题交互：点击选项反馈对错，答对显示解析并上报任务完成
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.quiz-option');
  if (!opt) return;
  const wrap = opt.closest('.quiz-options');
  if (!wrap || wrap.dataset.locked) return;
  const answer = parseInt(wrap.dataset.answer, 10);
  const chosen = parseInt(opt.dataset.oi, 10);
  const task = opt.closest('.learn-task');
  const fb = task ? task.querySelector('.quiz-feedback') : null;

  const options = [...wrap.querySelectorAll('.quiz-option')];
  options.forEach((o) => {
    o.classList.remove('correct', 'wrong');
    if (parseInt(o.dataset.oi, 10) === answer) o.classList.add('correct');
  });

  if (chosen === answer) {
    opt.classList.add('correct');
    wrap.dataset.locked = '1';
    if (fb) {
      const explain = task.dataset.explain || '';
      fb.innerHTML = `<span class="quiz-fb-ok">✓ 回答正确！</span>${explain ? `<span class="quiz-explain">${Utils.escapeHtml(explain)}</span>` : ''}`;
      fb.classList.add('show');
    }
    // 答对 → 任务完成
    reportTask(parseInt(task.dataset.article, 10), parseInt(task.dataset.task, 10));
  } else {
    opt.classList.add('wrong');
    if (fb) {
      fb.innerHTML = `<span class="quiz-fb-no">✗ 不对哦，再想想～</span>`;
      fb.classList.add('show');
    }
  }
});
