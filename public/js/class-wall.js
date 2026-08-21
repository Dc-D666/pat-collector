'use strict';

// 全校作品展视图：所有班级的项目平铺展示（文件 + 轻应用），班级用 tag 标识，实时搜索
window.Views = window.Views || {};
Views.classWall = async () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, toast } = Utils;
  const view = document.getElementById('view');
  const myClass = (API.getUser() || {}).class_name || '';

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">全校作品展</h1>
        <div class="page-sub" id="wall-sub">全校同学的作品与轻应用</div>
      </div>
      <div class="search-box">
        <span class="search-icon">${Icons.icon('search', 16)}</span>
        <input id="wall-search" placeholder="搜索项目标题 / 作者 / 班级" />
      </div>
      <div class="wall-sort">
        <button class="sort-btn active" data-sort="time">${Icons.icon('time', 15)} 最新发表</button>
        <button class="sort-btn" data-sort="likes">${Icons.icon('heart', 15)} 点赞最多</button>
        <button class="wall-filter-btn" id="wall-mine-btn" ${myClass ? '' : 'disabled'} title="${myClass ? '只看自己班级同学的作品' : '仅 QQ 登录用户可查看班级'}">${Icons.icon('filter', 15)} 仅看本班</button>
      </div>
      <div id="wall-content"><div class="spinner"></div></div>
    </div>`;

  let projects = [];
  let sortMode = 'time'; // time = 发表时间从新到旧（默认）；likes = 点赞数从多到少
  let onlyMyClass = false; // 「仅看本班」筛选（2026-08-22）

  try {
    const data = await API.get('/api/class/wall');
    projects = data.projects || [];
    document.getElementById('wall-sub').textContent =
      `全校共 ${projects.length} 个项目 · 文件与 AI 轻应用混排展示`;
  } catch (err) {
    document.getElementById('wall-content').innerHTML =
      `<div class="empty"><div class="empty-icon">${Icons.icon('error-circle', 26)}</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  function classTag(p) {
    const isMine = p.class_name === myClass;
    return `<span class="proj-tag ${isMine ? 'tag-mine' : ''}">${escapeHtml(p.class_name)}班</span>`;
  }

  function render(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const content = document.getElementById('wall-content');

    const visible = projects.filter((p) => {
      if (onlyMyClass && p.class_name !== myClass) return false; // 仅看本班
      if (!q) return true;
      const hay = [
        p.title,
        p.original_name,
        p.display_name,
        p.class_name,
        p.description,
        p.gameplay,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    // 排序：置顶始终优先；其余按所选模式（默认发表时间从新到旧 / 点赞数从多到少）
    visible.sort((a, b) => {
      if (a.topped !== b.topped) return a.topped ? -1 : 1;
      if (sortMode === 'likes') return (b.like_count || 0) - (a.like_count || 0);
      return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
    });

    if (!visible.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">${Icons.icon('search', 26)}</div>没有匹配的项目</div>`;
      return;
    }

    content.innerHTML = `<div class="wall-grid">${visible.map((p) => {
      const isFile = p.type === 'file';
      const isLink = p.type === 'link';
      const icon = isFile
        ? getFileIcon(p.original_name || '')
        : (isLink ? { icon: 'link', color: '#E3E8F5' } : { icon: 'robot', color: '#EDE6D6' });
      // 全校公开：所有文件都可下载/预览（不再限同班）
      const canDl = isFile;
      // HTML 文件额外提供「预览」：新窗口直接打开（CSP sandbox 隔离）
      const isHtml = isFile && /\.(html?|htm)$/i.test(p.original_name || '');
      const likeDisabled = p.is_mine || p.liked_by_me;
      return `
        <div class="card project-card${p.topped ? ' topped' : ''}">
          ${p.topped ? '<div class="top-badge">' + Icons.icon('pin', 13) + ' 置顶 24h</div>' : ''}
          <div class="proj-head">
            <div class="proj-icon" style="background:${icon.color};">${Icons.icon(icon.icon, 20)}</div>
            <div class="proj-main">
              <div class="proj-title">${escapeHtml(p.title || (isFile ? p.original_name : (isLink ? 'GitHub 项目' : 'AI 轻应用')))}</div>
              <div class="proj-meta">${classTag(p)}<span class="proj-author">${escapeHtml(p.display_name)}</span>${p.title_tag ? `<span class="title-tag">${escapeHtml(p.title_tag)}</span>` : ''}</div>
            </div>
          </div>
          ${p.description ? `<div class="proj-desc">${escapeHtml(p.description)}</div>` : ''}
          ${p.gameplay ? `<div class="proj-desc">玩法：${escapeHtml(p.gameplay)}</div>` : ''}
          <div class="proj-foot">
            <div class="proj-time">
              ${isFile
                ? `${escapeHtml(p.original_name)} · ${formatSize(p.size)}<br>${formatTime(p.time)}`
                : (isLink ? `${escapeHtml(p.owner + '/' + p.repo)}<br>${formatTime(p.time)}` : formatTime(p.time))}
            </div>
            <div class="file-actions">
              <button class="like-btn${p.liked_by_me ? ' liked' : ''}" data-like="${p.type}:${p.id}"
                ${likeDisabled ? 'disabled' : ''} title="${p.is_mine ? '不能给自己点赞' : (p.liked_by_me ? '已点赞' : '点赞支持一下（+2 积分）')}">
                ${p.liked_by_me ? Icons.icon('heart-filled', 15) : Icons.icon('heart', 15)}<span>${p.like_count || 0}</span>
              </button>
              ${isFile
                ? (canDl
                    ? `<button class="btn btn-sm btn-ghost" data-dl="${p.id}" data-name="${escapeHtml(p.original_name)}">下载</button>${isHtml
                        ? `<a class="btn btn-sm btn-primary" href="/preview.html?v=2#/file/${p.id}" target="_blank" rel="noopener">预览</a>`
                        : ''}`
                    : `<span class="proj-lock" title="仅同班可下载">🔒</span>`)
                : (isLink
                    ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">前往 GitHub</a>`
                    : `<a class="btn btn-sm btn-primary" href="${escapeHtml(p.app_url)}" target="_blank" rel="noopener">跳转试玩</a>`)}
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;

    content.querySelectorAll('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        try { await API.download(b.dataset.dl, b.dataset.name); }
        catch (err) { toast(err.message); }
      };
    });

    // 点赞：成功后按钮置为已赞态并 +1
    content.querySelectorAll('[data-like]').forEach((b) => {
      b.onclick = async () => {
        if (b.disabled) return;
        b.disabled = true;
        const [targetType, targetId] = b.dataset.like.split(':');
        try {
          const r = await API.post('/api/points/like', JSON.stringify({ target_type: targetType, target_id: Number(targetId) }));
          if (r && r.ok) {
            b.classList.add('liked');
            const num = b.querySelector('span');
            num.textContent = (Number(num.textContent) || 0) + 1;
            b.innerHTML = Icons.icon('heart-filled', 15) + `<span>${num.textContent}</span>`;
            b.title = '已点赞';
            toast((r.author_gained ? Icons.icon('heart-filled', 14) + ' 点赞成功 作者 +2 ' + Icons.icon('star-filled', 14) : Icons.icon('heart-filled', 14) + ' 点赞成功'), { html: true });
          } else {
            b.disabled = false;
          }
        } catch (err) {
          b.disabled = false;
          toast(err.message);
        }
      };
    });
  }

  document.getElementById('wall-search').oninput = (e) => render(e.target.value);

  // 排序切换
  view.querySelectorAll('.sort-btn').forEach((b) => {
    b.onclick = () => {
      sortMode = b.dataset.sort;
      view.querySelectorAll('.sort-btn').forEach((x) => x.classList.toggle('active', x === b));
      render(document.getElementById('wall-search').value);
    };
  });

  // 「仅看本班」筛选（2026-08-22）：切换本地筛选 + 副标题计数
  const mineBtn = document.getElementById('wall-mine-btn');
  if (mineBtn && myClass) {
    mineBtn.onclick = () => {
      onlyMyClass = !onlyMyClass;
      mineBtn.classList.toggle('active', onlyMyClass);
      render(document.getElementById('wall-search').value);
      const sub = document.getElementById('wall-sub');
      if (sub) {
        const n = projects.filter((p) => !onlyMyClass || p.class_name === myClass).length;
        sub.textContent = onlyMyClass
          ? `本班共 ${n} 个项目`
          : `全校共 ${projects.length} 个项目 · 文件与 AI 轻应用混排展示`;
      }
    };
  }

  render('');
};
