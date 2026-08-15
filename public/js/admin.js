'use strict';

// 管理后台（#/admin*）：总览 / 用户 / 文件 / 内容审核。仅 is_admin 可见（app.js 路由守卫 + 后端 requireAdmin 双保险）。
window.Views = window.Views || {};
Views.admin = (page) => {
  const { escapeHtml, formatSize, formatTime, openModal, closeModal, confirm, toast } = Utils;
  const view = document.getElementById('view');
  const u = API.getUser() || {};
  if (!u.is_admin) {
    toast('无管理员权限');
    location.hash = '#/files';
    return;
  }
  // 评委评审维度与权重（P3）：必须放在 loaders 调用之前（否则 loadJudge 触发 TDZ ReferenceError）
  const JUDGE_DIMS = [
    { key: 'creativity', label: '创意与创新', weight: 0.30 },
    { key: 'content', label: '内容质量', weight: 0.25 },
    { key: 'completeness', label: '完成度与实现', weight: 0.25 },
    { key: 'values', label: '价值观与合规', weight: 0.20 },
  ];

  const current = page || 'overview';
  const TABS = [
    { key: 'overview', label: '总览', hash: '#/admin' },
    { key: 'users', label: '用户', hash: '#/admin/users' },
    { key: 'files', label: '文件', hash: '#/admin/files' },
    { key: 'audit', label: '审核', hash: '#/admin/audit' },
    { key: 'apps', label: '轻应用', hash: '#/admin/apps' },
    { key: 'points', label: '积分', hash: '#/admin/points' },
    { key: 'ops', label: '运营', hash: '#/admin/ops' },
    { key: 'judge', label: '评审', hash: '#/admin/judge' },
    { key: 'storage', label: '运维', hash: '#/admin/storage' },
    { key: 'articles', label: '教程', hash: '#/admin/articles' },
    { key: 'settings', label: '设置', hash: '#/admin/settings' },
    { key: 'logs', label: '审计', hash: '#/admin/logs' },
  ];

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">管理后台</h1>
        <div class="page-sub">运营视图 · 操作均记录审计日志</div>
      </div>
      <div class="tabs" id="admin-tabs">
        ${TABS.map((t) => `<button class="tab-btn ${t.key === current ? 'active' : ''}" data-key="${t.key}" data-hash="${t.hash}">${t.label}</button>`).join('')}
      </div>
      <div id="admin-content" style="margin-top:14px;"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('admin-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn && btn.dataset.hash) location.hash = btn.dataset.hash;
  });

  const content = document.getElementById('admin-content');
  // 各页签的刷新句柄（由 loadX 赋值，供弹窗/操作回调复用，避免闭包作用域问题）
  let refreshUsers = null, refreshFiles = null, refreshAudit = null, refreshApps = null, refreshOps = null;
  // 教程独立编辑页子路由：#/admin/articles/new | #/admin/articles/edit/:id
  if (current === 'articles') {
    const m = (location.hash || '').match(/^#\/admin\/articles\/(edit\/(\d+)|new)$/);
    if (m) { renderArticleEditor(m[1] === 'new' ? null : Number(m[2])); return; }
  }
  const loaders = {
    overview: loadOverview, users: loadUsers, files: loadFiles, audit: loadAudit,
    apps: loadApps, points: loadPoints, ops: loadOps, judge: loadJudge, storage: loadStorage,
    articles: loadArticles, settings: loadSettings, logs: loadLogs,
  };
  (loaders[current] || loadOverview)();

  // ---------- 总览 ----------
  async function loadOverview() {
    content.innerHTML = `<div class="spinner"></div>`;
    let s;
    try { s = await API.get('/api/admin/stats'); } catch (err) { content.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const fmt = (n) => (n == null ? '-' : String(n));
    const cards = [
      ['用户总数', fmt(s.users), `今日新增 ${fmt(s.users_today)} · 管理员 ${fmt(s.admins)}`],
      ['文件总数', fmt(s.files), `今日上传 ${fmt(s.files_today)} · 今日上传动作 ${fmt(s.uploads_today)}`],
      ['轻应用', fmt(s.apps), ''],
      ['积分总量', fmt(s.points_total), ''],
      ['存储占用', formatSize(s.storage_bytes), `磁盘剩余 ${s.disk_free_bytes != null ? formatSize(s.disk_free_bytes) : '-'}`],
      ['待审核', fmt(s.audit_pending), `违规标记 ${fmt(s.audit_flagged)}`],
    ];
    content.innerHTML = `
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${cards.map(([icon, val, sub]) => `
          <div class="card" style="padding:16px;">
            <div style="font-size:13px;color:var(--text-dim);">${icon}</div>
            <div style="font-size:24px;font-weight:700;margin:6px 0;">${escapeHtml(val)}</div>
            ${sub ? `<div style="font-size:12px;color:var(--text-dim);">${escapeHtml(sub)}</div>` : ''}
          </div>`).join('')}
      </div>`;
    if (s.audit_pending > 0) {
      content.insertAdjacentHTML('beforeend', `<a class="btn btn-primary btn-sm" href="#/admin/audit" style="margin-top:12px;">去处理 ${s.audit_pending} 个待审核文件 →</a>`);
    }
  }

  // ---------- 用户 ----------
  async function loadUsers() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="au-q" type="text" placeholder="搜索姓名/昵称/班级" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <input id="au-token" type="text" placeholder="访客项目地址令牌前缀" style="width:200px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <select id="au-role" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="">全部身份</option><option value="guest">访客直传</option><option value="qq">QQ 用户</option>
        </select>
        <select id="au-status" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="">全部状态</option><option value="admin">管理员</option><option value="disabled">已停用</option>
        </select>
        <button class="btn btn-sm" id="au-search">搜索</button>
      </div>
      <div id="au-list"><div class="spinner"></div></div>`;
    const doSearch = () => {
      const q = document.getElementById('au-q').value.trim();
      const token = document.getElementById('au-token').value.trim();
      const role = document.getElementById('au-role').value;
      const status = document.getElementById('au-status').value;
      fetchUsers({ q, token, role, status });
    };
    document.getElementById('au-search').onclick = doSearch;
    document.getElementById('au-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    document.getElementById('au-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    refreshUsers = doSearch;
    doSearch();
  }

  async function fetchUsers({ q = '', token = '', role = '', status = '' } = {}) {
    const list = document.getElementById('au-list');
    if (!list) return;
    let data;
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (token) qs.set('token', token);
      if (role) qs.set('role', role);
      if (status) qs.set('status', status);
      data = await API.get('/api/admin/users?' + qs.toString());
    } catch (err) {
      list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      return;
    }
    const rows = data.users || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">没有匹配的用户</div>`; return; }
    list.innerHTML = rows.map((x) => `
      <div class="card" style="padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div class="file-name" style="font-size:15px;">
              ${escapeHtml(x.class_name ? x.class_name + '班' : '')} ${escapeHtml(x.real_name || '')}
              ${x.is_admin ? '<span class="audit-tag" style="color:var(--primary);">管理员</span>' : ''}
              ${x.status !== 'active' ? '<span class="audit-tag" style="color:var(--danger);">已停用</span>' : ''}
              ${x.is_guest ? '<span class="audit-tag">访客</span>' : ''}
            </div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">
              id=${x.id} · ${x.qq_tiny_id ? 'QQ已绑定' : '未绑QQ'} · 文件 ${x.file_count} · 应用 ${x.app_count} · 占用 ${formatSize(x.storage_bytes)} · 今日上传 ${x.uploads_today} · 注册 ${formatTime(x.created_at)}
            </div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);">${x.points} 分</div>
          </div>
          <div class="file-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-ghost" data-act="points" data-id="${x.id}" data-name="${escapeHtml(x.real_name)}">调积分</button>
            ${x.qq_tiny_id ? `<button class="btn btn-sm btn-ghost" data-act="admin" data-id="${x.id}" data-on="${x.is_admin ? '1' : '0'}">${x.is_admin ? '取消管理员' : '设为管理员'}</button>` : ''}
            <button class="btn btn-sm btn-ghost" data-act="status" data-id="${x.id}" data-st="${x.status}">${x.status === 'active' ? '停用' : '恢复'}</button>
            ${x.is_guest ? `<button class="btn btn-sm btn-ghost" data-act="pwreset" data-id="${x.id}">重置删除密码</button>` : ''}
            <button class="btn btn-sm btn-ghost" data-act="del" data-id="${x.id}" data-name="${escapeHtml(x.real_name)}" style="color:var(--danger);">删除</button>
          </div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        const name = b.dataset.name || '';
        if (b.dataset.act === 'points') { showPointsModal(id, name); return; }
        if (b.dataset.act === 'admin') {
          const on = b.dataset.on === '1';
          try {
            await API.post('/api/admin/users/' + id + '/admin', JSON.stringify({ enabled: !on }));
            toast(on ? '已取消管理员' : '已设为管理员');
            if (refreshUsers) refreshUsers();
          } catch (err) { toast(err.message); }
          return;
        }
        if (b.dataset.act === 'status') {
          const to = b.dataset.st === 'active' ? 'disabled' : 'active';
          const yes = await confirm(`确定${to === 'disabled' ? '停用' : '恢复'}「${name}」吗？${to === 'disabled' ? '停用后其无法登录/上传。' : ''}`, { danger: to === 'disabled' });
          if (!yes) return;
          try { await API.post('/api/admin/users/' + id + '/status', JSON.stringify({ status: to })); toast('已' + (to === 'disabled' ? '停用' : '恢复')); if (refreshUsers) refreshUsers(); }
          catch (err) { toast(err.message); }
          return;
        }
        if (b.dataset.act === 'pwreset') {
          const yes = await confirm(`重置「${name}」的访客删除密码为默认密码？`, { danger: true });
          if (!yes) return;
          try { await API.post('/api/admin/users/' + id + '/guest-pwd-reset', '{}'); toast('已重置为默认密码'); }
          catch (err) { toast(err.message); }
          return;
        }
        if (b.dataset.act === 'del') {
          const yes = await confirm(`确定删除用户「${name}」及其全部文件/应用/流水吗？不可恢复！`, { danger: true });
          if (!yes) return;
          try { await API.del('/api/admin/users/' + id); toast('已删除'); if (refreshUsers) refreshUsers(); }
          catch (err) { toast(err.message); }
        }
      };
    });
  }

  function showPointsModal(uid, name) {
    openModal(`
      <h3 class="modal-title">调整积分 · ${escapeHtml(name)}</h3>
      <div class="form-error" id="adm-pts-error"></div>
      <div class="field"><label>变动值（正数加 / 负数扣）</label><input id="adm-pts-amount" type="number" placeholder="如 100 或 -50" /></div>
      <div class="field"><label>原因（必填，记入流水）</label><input id="adm-pts-reason" type="text" maxlength="50" placeholder="如：活动奖励 / 违规扣回" /></div>
      <div class="modal-actions">
        <button class="btn" id="adm-pts-cancel">取消</button>
        <button class="btn btn-primary" id="adm-pts-save">确定</button>
      </div>`);
    document.getElementById('adm-pts-cancel').onclick = closeModal;
    document.getElementById('adm-pts-save').onclick = async () => {
      const errEl = document.getElementById('adm-pts-error');
      errEl.classList.remove('show');
      const amount = parseInt(document.getElementById('adm-pts-amount').value, 10);
      const reason = document.getElementById('adm-pts-reason').value.trim();
      if (!Number.isInteger(amount) || amount === 0) { errEl.textContent = '请输入不为 0 的整数'; errEl.classList.add('show'); return; }
      if (!reason) { errEl.textContent = '请填写原因'; errEl.classList.add('show'); return; }
      try {
        await API.post('/api/admin/users/' + uid + '/points', JSON.stringify({ amount, reason }));
        closeModal();
        toast('已调整积分');
        if (refreshUsers) refreshUsers(); else loadUsers();
      } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
    };
  }

  // ---------- 文件 ----------
  async function loadFiles() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="af-q" type="text" placeholder="搜索文件名/标题/作者/班级" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <select id="af-audit" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="">全部状态</option><option value="pending">待审核</option><option value="flagged">违规标记</option><option value="reviewed">已通过</option>
        </select>
        <button class="btn btn-sm" id="af-search">搜索</button>
      </div>
      <div id="af-list"><div class="spinner"></div></div>`;
    const doSearch = () => {
      const q = document.getElementById('af-q').value.trim();
      const audit = document.getElementById('af-audit').value;
      fetchFiles({ q, audit });
    };
    document.getElementById('af-search').onclick = doSearch;
    document.getElementById('af-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    refreshFiles = doSearch;
    doSearch();
  }

  async function fetchFiles({ q = '', audit = '' } = {}) {
    const list = document.getElementById('af-list');
    if (!list) return;
    let data;
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (audit) qs.set('audit', audit);
      data = await API.get('/api/admin/files?' + qs.toString());
    } catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const rows = data.files || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">没有匹配的文件</div>`; return; }
    const statusTag = { pending: ['待审核', 'var(--text-dim)'], reviewed: ['已通过', 'var(--success)'], flagged: ['违规', 'var(--danger)'] };
    list.innerHTML = rows.map((f) => {
      const st = statusTag[f.audit_status] || ['?', ''];
      return `
      <div class="card" style="padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div class="file-name" style="font-size:15px;">${escapeHtml(f.title || f.original_name)} <span class="audit-tag" style="color:${st[1]};">${st[0]}</span></div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">
              ${escapeHtml(f.original_name)} · ${formatSize(f.size)} · ${f.class_name}班 ${escapeHtml(f.real_name || '')} · ${formatTime(f.uploaded_at)} · id=${f.id}
            </div>
            ${f.audit_reason ? `<div class="file-meta" style="font-size:12px;color:var(--danger);">审核原因：${escapeHtml(f.audit_reason)}</div>` : ''}
          </div>
          <div class="file-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
            ${/\.(html?|htm)$/i.test(f.original_name) ? `<a class="btn btn-sm btn-ghost" href="/api/files/preview/${f.id}?token=${encodeURIComponent(API.getToken() || '')}" target="_blank" rel="noopener">预览</a>` : ''}
            <button class="btn btn-sm btn-ghost" data-act="dl" data-id="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button>
            <button class="btn btn-sm btn-ghost" data-act="edit" data-id="${f.id}" data-name="${escapeHtml(f.original_name)}">编辑</button>
            <button class="btn btn-sm btn-ghost" data-act="del" data-id="${f.id}" data-name="${escapeHtml(f.original_name)}" style="color:var(--danger);">删除</button>
          </div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        const name = b.dataset.name || '';
        if (b.dataset.act === 'dl') {
          try { await API.download(id, name); }
          catch (err) { toast(err.message); }
          return;
        }
        if (b.dataset.act === 'edit') { showFileEditModal(id, name); return; }
        if (b.dataset.act === 'del') {
          const yes = await confirm(`确定删除文件「${name}」吗？（回扣提交积分，不可恢复）`, { danger: true });
          if (!yes) return;
          try { await API.del('/api/admin/files/' + id); toast('已删除'); if (refreshFiles) refreshFiles(); }
          catch (err) { toast(err.message); }
        }
      };
    });
  }

  function showFileEditModal(fid, name) {
    openModal(`
      <h3 class="modal-title">编辑文件 · ${escapeHtml(name)}</h3>
      <div class="form-error" id="adm-fe-error"></div>
      <div class="field"><label>审核状态</label>
        <select id="adm-fe-status">
          <option value="reviewed">已通过</option><option value="pending">待审核</option><option value="flagged">违规标记</option>
        </select>
      </div>
      <div class="field"><label>审核原因（违规时填写）</label><input id="adm-fe-reason" type="text" maxlength="500" placeholder="选填" /></div>
      <div class="field"><label>标题</label><input id="adm-fe-title" type="text" maxlength="255" placeholder="作品标题" /></div>
      <div class="field"><label>简介</label><input id="adm-fe-desc" type="text" maxlength="2000" placeholder="选填" /></div>
      <div class="modal-actions">
        <button class="btn" id="adm-fe-cancel">取消</button>
        <button class="btn btn-primary" id="adm-fe-save">保存</button>
      </div>`);
    document.getElementById('adm-fe-cancel').onclick = closeModal;
    document.getElementById('adm-fe-save').onclick = async () => {
      const errEl = document.getElementById('adm-fe-error');
      errEl.classList.remove('show');
      try {
        await API.patch('/api/admin/files/' + fid, JSON.stringify({
          audit_status: document.getElementById('adm-fe-status').value,
          audit_reason: document.getElementById('adm-fe-reason').value.trim(),
          title: document.getElementById('adm-fe-title').value.trim(),
          description: document.getElementById('adm-fe-desc').value.trim(),
        }));
        closeModal();
        toast('已保存');
        if (refreshFiles) refreshFiles();
      } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
    };
  }

  // ---------- 审核 ----------
  async function loadAudit() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <select id="aa-status" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="pending">待审核</option><option value="flagged">违规标记</option><option value="reviewed">已通过</option>
        </select>
        <button class="btn btn-sm" id="aa-search">刷新</button>
        <span style="margin-left:auto;"></span>
        <label style="align-self:center;font-size:13px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="aa-all" /> 全选</label>
        <button class="btn btn-sm" id="aa-batch-approve">批量通过</button>
        <button class="btn btn-sm" id="aa-batch-del" style="color:var(--danger);">批量删除</button>
      </div>
      <div id="aa-list"><div class="spinner"></div></div>`;
    const doSearch = () => fetchAudit(document.getElementById('aa-status').value);
    document.getElementById('aa-search').onclick = doSearch;
    document.getElementById('aa-status').onchange = doSearch;
    document.getElementById('aa-all').onchange = (e) => {
      document.querySelectorAll('#aa-list input[data-check]').forEach((c) => { c.checked = e.target.checked; });
    };
    document.getElementById('aa-batch-approve').onclick = () => batchAudit('approve');
    document.getElementById('aa-batch-del').onclick = () => batchAudit('delete');
    refreshAudit = doSearch;
    doSearch();
  }

  function selectedAuditIds() {
    return [...document.querySelectorAll('#aa-list input[data-check]:checked')].map((c) => Number(c.dataset.check));
  }

  async function batchAudit(action) {
    const ids = selectedAuditIds();
    if (!ids.length) { toast('请先勾选文件'); return; }
    const label = action === 'approve' ? '通过' : '删除';
    const yes = await confirm(`确定批量${label} ${ids.length} 个文件吗？${action === 'delete' ? '删除会回扣提交积分，不可恢复！' : ''}`, { danger: action === 'delete' });
    if (!yes) return;
    try {
      const r = await API.post('/api/admin/audit/batch', JSON.stringify({ action, ids }));
      toast(`${label}完成：${r.processed || 0} 个${action === 'approve' && r.points_restored ? '，补发积分 ' + r.points_restored : ''}`);
      const sel = document.getElementById('aa-status');
      fetchAudit(sel ? sel.value : 'pending');
    } catch (err) { toast(err.message); }
  }

  async function fetchAudit(status) {
    const list = document.getElementById('aa-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/audit?status=' + encodeURIComponent(status)); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const rows = data.files || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">没有该状态的文件</div>`; return; }
    list.innerHTML = rows.map((f) => `
      <div class="card" style="padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;gap:10px;min-width:0;">
            <input type="checkbox" data-check="${f.id}" style="margin-top:4px;flex-shrink:0;" />
          <div style="min-width:0;">
            <div class="file-name" style="font-size:15px;">${escapeHtml(f.original_name)} <span class="audit-tag">${status === 'flagged' ? '违规' : status === 'reviewed' ? '已通过' : '待审核'}</span></div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">
              ${formatSize(f.size)} · ${f.class_name}班 ${escapeHtml(f.real_name || '')} · ${formatTime(f.uploaded_at)} · id=${f.id}
            </div>
            ${f.audit_reason ? `<div class="file-meta" style="font-size:12px;color:var(--danger);">原因：${escapeHtml(f.audit_reason)}</div>` : ''}
          </div>
          </div>
          <div class="file-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
            ${status !== 'reviewed' ? `<button class="btn btn-sm btn-primary" data-act="approve" data-id="${f.id}">通过</button>` : ''}
            ${status === 'pending' ? `<button class="btn btn-sm btn-ghost" data-act="reject" data-id="${f.id}">拒绝</button>` : ''}
            <button class="btn btn-sm btn-ghost" data-act="del" data-id="${f.id}" style="color:var(--danger);">删除</button>
          </div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.act === 'approve') {
          const yes = await confirm('标记为已通过？');
          if (!yes) return;
          try { await API.post('/api/admin/audit/' + id + '/review', JSON.stringify({ action: 'approve' })); toast('已通过'); if (refreshAudit) refreshAudit(); }
          catch (err) { toast(err.message); }
          return;
        }
        if (b.dataset.act === 'reject') { showRejectModal(id); return; }
        if (b.dataset.act === 'del') {
          const yes = await confirm('确定删除该文件吗？（回扣提交积分，不可恢复）', { danger: true });
          if (!yes) return;
          try { await API.post('/api/admin/audit/' + id + '/review', JSON.stringify({ action: 'delete' })); toast('已删除'); if (refreshAudit) refreshAudit(); }
          catch (err) { toast(err.message); }
        }
      };
    });
  }

  function showRejectModal(fid) {
    openModal(`
      <h3 class="modal-title">拒绝收录</h3>
      <div class="form-error" id="adm-rj-error"></div>
      <div class="field"><label>拒绝原因（展示给用户）</label><input id="adm-rj-reason" type="text" maxlength="500" placeholder="如：包含违规内容" /></div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">拒绝将回扣该文件的 +50 提交积分。</div>
      <div class="modal-actions">
        <button class="btn" id="adm-rj-cancel">取消</button>
        <button class="btn" id="adm-rj-save" style="background:var(--danger);color:#fff;">拒绝并回扣积分</button>
      </div>`);
    document.getElementById('adm-rj-cancel').onclick = closeModal;
    document.getElementById('adm-rj-save').onclick = async () => {
      const errEl = document.getElementById('adm-rj-error');
      errEl.classList.remove('show');
      try {
        await API.post('/api/admin/audit/' + fid + '/review', JSON.stringify({
          action: 'reject',
          reason: document.getElementById('adm-rj-reason').value.trim(),
        }));
        closeModal();
        toast('已拒绝并回扣积分');
        if (refreshAudit) refreshAudit(); else loadAudit();
      } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
    };
  }

  // ---------- 轻应用 ----------
  async function loadApps() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="aa-q" type="text" placeholder="搜索应用名/链接/作者/班级" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <button class="btn btn-sm" id="aa-search">搜索</button>
      </div>
      <div id="aa-list"><div class="spinner"></div></div>`;
    const doSearch = () => fetchApps(document.getElementById('aa-q').value.trim());
    document.getElementById('aa-search').onclick = doSearch;
    document.getElementById('aa-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    refreshApps = doSearch;
    doSearch();
  }

  async function fetchApps(q) {
    const list = document.getElementById('aa-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/apps' + (q ? '?q=' + encodeURIComponent(q) : '')); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const rows = data.apps || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">没有匹配的轻应用</div>`; return; }
    list.innerHTML = rows.map((a) => `
      <div class="card" style="padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div class="file-name" style="font-size:15px;"><a href="${escapeHtml(a.app_url)}" target="_blank" rel="noopener">${escapeHtml(a.title || a.app_url)}</a></div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">
              ${a.class_name}班 ${escapeHtml(a.real_name || '')} · ${formatTime(a.created_at)} · id=${a.id} ${a.source_feed_id ? '· 来源帖 ' + escapeHtml(a.source_feed_id) : ''}
            </div>
            ${a.description ? `<div class="file-meta" style="font-size:12px;color:var(--text-dim);">${escapeHtml(a.description)}</div>` : ''}
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-ghost" data-del="${a.id}" data-name="${escapeHtml(a.title || a.app_url)}" style="color:var(--danger);">删除</button>
          </div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const yes = await confirm(`确定删除轻应用「${b.dataset.name}」吗？（回扣 +25 提交积分）`, { danger: true });
        if (!yes) return;
        try { await API.del('/api/admin/apps/' + b.dataset.del); toast('已删除'); if (refreshApps) refreshApps(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  // ---------- 积分 ----------
  async function loadPoints() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="ap-uid" type="number" placeholder="按用户 id 查流水" style="width:150px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <select id="ap-reason" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="">全部类型</option>
          <option value="first_login">首次登录</option><option value="read_article">阅读课程</option><option value="task">完成任务</option>
          <option value="app_submit">提交轻应用</option><option value="file_submit">提交文件</option><option value="admin_adjust">管理员调整</option>
          <option value="file_submit_revoke">文件回扣</option><option value="purchase">商城消费</option>
        </select>
        <button class="btn btn-sm" id="ap-search">查流水</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:14px;" id="ap-board"></div>
      <div id="ap-logs"><div class="spinner"></div></div>`;
    const doSearch = () => {
      const uid = document.getElementById('ap-uid').value.trim();
      const reason = document.getElementById('ap-reason').value;
      fetchPointsLogs({ uid, reason });
    };
    document.getElementById('ap-search').onclick = doSearch;
    document.getElementById('ap-uid').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    fetchLeaderboard();
    doSearch();
  }

  async function fetchLeaderboard() {
    const board = document.getElementById('ap-board');
    if (!board) return;
    let data;
    try { data = await API.get('/api/admin/points/leaderboard'); } catch (_) { board.innerHTML = ''; return; }
    const rows = (data.users || []).slice(0, 10);
    board.innerHTML = `<div class="card" style="grid-column:1/-1;padding:12px 14px;"><b> 积分榜 TOP10</b></div>` +
      rows.map((x, i) => `
      <div class="card" style="padding:10px 14px;">
        <div style="font-size:15px;font-weight:600;">${i + 1}. ${escapeHtml(x.class_name + '班 ' + (x.real_name || ''))}</div>
        <div style="font-size:12px;color:var(--text-dim);">${x.points} 分 ${x.is_admin ? '· 管理员' : ''}</div>
      </div>`).join('') || `<div class="empty">暂无数据</div>`;
  }

  async function fetchPointsLogs({ uid = '', reason = '' } = {}) {
    const list = document.getElementById('ap-logs');
    if (!list) return;
    let data;
    try {
      const qs = new URLSearchParams();
      if (uid) qs.set('user_id', uid);
      if (reason) qs.set('reason', reason);
      data = await API.get('/api/admin/points/logs?' + qs.toString());
    } catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const logs = data.logs || [];
    if (!logs.length) { list.innerHTML = `<div class="empty">没有匹配的流水</div>`; return; }
    list.innerHTML = `<div class="card" style="padding:12px 14px;"><div class="file-list-head"><span>共 ${logs.length} 条流水</span></div>` +
      logs.map((l) => `
      <div class="file-row">
        <div class="file-info">
          <div class="file-name">${escapeHtml(l.reason_text)} ${l.amount > 0 ? `<span style="color:var(--success);">+${l.amount}</span>` : `<span style="color:var(--danger);">${l.amount}</span>`}</div>
          <div class="file-meta">${l.class_name}班 ${escapeHtml(l.real_name || '')} (id=${l.user_id}) · ${formatTime(l.created_at)} · ref=${escapeHtml(l.ref_id || '')}</div>
        </div>
      </div>`).join('') + `</div>`;
  }

  // ---------- 运营（置顶/称号/商城开关）----------
  async function loadOps() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm" id="ao-pin"> 手动置顶作品</button>
        <button class="btn btn-sm" id="ao-title"> 发放称号</button>
        <button class="btn btn-sm" id="ao-shop"> 商城开关</button>
        <span style="margin-left:auto;"></span>
        <select id="ao-status" style="padding:9px;border:1px solid var(--border);border-radius:10px;">
          <option value="active">生效中</option><option value="expired">已过期</option><option value="">全部</option>
        </select>
        <button class="btn btn-sm" id="ao-refresh">刷新</button>
      </div>
      <div id="ao-list"><div class="spinner"></div></div>`;
    const doSearch = () => fetchPurchases(document.getElementById('ao-status').value);
    document.getElementById('ao-refresh').onclick = doSearch;
    document.getElementById('ao-status').onchange = doSearch;
    refreshOps = doSearch;
    document.getElementById('ao-pin').onclick = showPinModal;
    document.getElementById('ao-title').onclick = showTitleModal;
    document.getElementById('ao-shop').onclick = toggleShop;
    doSearch();
  }


  async function fetchPurchases(status) {
    const list = document.getElementById('ao-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/purchases' + (status ? '?status=' + status : '')); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const rows = data.purchases || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">没有记录</div>`; return; }
    const itemText = { wall_top: '作品展置顶', app_top: '频道帖置顶', app_essence: '频道精华', title: '称号' };
    list.innerHTML = rows.map((p) => `
      <div class="card" style="padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div>
            <div class="file-name" style="font-size:15px;">${itemText[p.item] || p.item}
              ${p.status === 'active' ? '<span class="audit-tag" style="color:var(--success);">生效中</span>' : '<span class="audit-tag" style="color:var(--text-dim);">已过期</span>'}
              ${p.title ? `<span class="audit-tag">${escapeHtml(p.title)}</span>` : ''}
            </div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">
              ${p.class_name}班 ${escapeHtml(p.real_name || '')} · ${p.ref_type}${p.ref_id ? '#' + p.ref_id : ''} · 花费 ${p.cost} · ${formatTime(p.created_at)}
              ${p.expires_at ? '· 到期 ' + formatTime(p.expires_at) : ''}
            </div>
          </div>
          <div class="file-actions">
            ${p.status === 'active' ? `<button class="btn btn-sm btn-ghost" data-expire="${p.id}" style="color:var(--danger);">手动过期</button>` : ''}
          </div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-expire]').forEach((b) => {
      b.onclick = async () => {
        const yes = await confirm('确定手动过期该记录？', { danger: true });
        if (!yes) return;
        try { await API.post('/api/admin/purchases/' + b.dataset.expire + '/expire', '{}'); toast('已过期'); if (refreshOps) refreshOps(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  function showPinModal() {
    openModal(`
      <h3 class="modal-title"> 手动置顶作品</h3>
      <div class="form-error" id="ao-pin-error"></div>
      <div class="field"><label>类型</label>
        <select id="ao-pin-type"><option value="file">文件</option><option value="app">轻应用</option></select>
      </div>
      <div class="field">
        <label>作品（输入标题 / 文件名 / 作者，动态匹配）</label>
        <div style="position:relative;">
          <input id="ao-pin-search" type="text" autocomplete="off" placeholder="输入关键词搜索作品…" />
          <input id="ao-pin-id" type="hidden" />
          <div id="ao-pin-dropdown" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;max-height:220px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);display:none;"></div>
        </div>
        <div id="ao-pin-selected" style="font-size:12px;color:var(--text-dim);margin-top:6px;"></div>
      </div>
      <div class="field"><label>置顶时长（小时，默认 24，上限 168）</label><input id="ao-pin-hours" type="number" value="24" /></div>
      <div class="modal-actions">
        <button class="btn" id="ao-pin-cancel">取消</button>
        <button class="btn btn-primary" id="ao-pin-save">置顶</button>
      </div>`);
    document.getElementById('ao-pin-cancel').onclick = closeModal;

    const searchEl = document.getElementById('ao-pin-search');
    const idEl = document.getElementById('ao-pin-id');
    const ddEl = document.getElementById('ao-pin-dropdown');
    const selEl = document.getElementById('ao-pin-selected');
    const typeEl = document.getElementById('ao-pin-type');
    let timer = null;

    const closeDd = () => { ddEl.style.display = 'none'; };
    const selectItem = (item) => {
      idEl.value = item.id;
      selEl.textContent = `已选择：#${item.id} ${item.name}（${item.meta}）`;
      searchEl.value = item.name;
      closeDd();
    };
    const renderDd = (items) => {
      if (!items.length) {
        ddEl.innerHTML = '<div style="padding:10px 12px;color:var(--text-dim);font-size:13px;">无匹配结果</div>';
        ddEl.style.display = 'block';
        return;
      }
      ddEl.innerHTML = items.map((it) => `
        <div data-id="${it.id}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" onmouseover="this.style.background='var(--primary-soft)'" onmouseout="this.style.background=''">
          <div style="font-weight:600;">${escapeHtml(it.name)}</div>
          <div style="color:var(--text-dim);font-size:12px;margin-top:1px;">${escapeHtml(it.meta)} · id=${it.id}</div>
        </div>`).join('');
      ddEl.style.display = 'block';
      ddEl.querySelectorAll('[data-id]').forEach((el) => {
        el.onclick = () => selectItem(items.find((x) => String(x.id) === el.dataset.id));
      });
    };
    const doSearch = async () => {
      const kw = searchEl.value.trim();
      if (!kw) { closeDd(); return; }
      const type = typeEl.value;
      try {
        const url = type === 'file'
          ? '/api/admin/files?q=' + encodeURIComponent(kw)
          : '/api/admin/apps?q=' + encodeURIComponent(kw);
        const data = await API.get(url);
        const items = (type === 'file' ? data.files : data.apps || []).map((x) => ({
          id: x.id,
          name: type === 'file' ? (x.title && x.title.trim() ? x.title : x.original_name) : x.title,
          meta: `${x.class_name || ''}班 ${x.real_name || ''}${type === 'file' && x.original_name ? ' · ' + x.original_name : ''}`,
        }));
        renderDd(items);
      } catch (_) { closeDd(); }
    };
    searchEl.addEventListener('input', () => {
      idEl.value = ''; selEl.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(doSearch, 250);
    });
    typeEl.addEventListener('change', () => {
      idEl.value = ''; selEl.textContent = ''; searchEl.value = '';
      closeDd();
    });
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDd(); });
    searchEl.addEventListener('blur', () => setTimeout(closeDd, 150));

    document.getElementById('ao-pin-save').onclick = async () => {
      const errEl = document.getElementById('ao-pin-error');
      errEl.classList.remove('show');
      const refId = parseInt(idEl.value, 10);
      if (!refId) {
        errEl.textContent = '请先从搜索结果中选择作品';
        errEl.classList.add('show');
        return;
      }
      try {
        await API.post('/api/admin/pins', JSON.stringify({
          ref_type: typeEl.value,
          ref_id: refId,
          hours: parseInt(document.getElementById('ao-pin-hours').value, 10) || 24,
        }));
        closeModal();
        toast('已置顶');
        fetchPurchases(document.getElementById('ao-status').value);
      } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
    };
  }

  function showTitleModal() {
    openModal(`
      <h3 class="modal-title"> 发放专属称号</h3>
      <div class="form-error" id="ao-title-error"></div>
      <div class="field"><label>用户 id</label><input id="ao-title-uid" type="number" placeholder="users.id" /></div>
      <div class="field"><label>称号文本</label><input id="ao-title-text" type="text" maxlength="64" placeholder="如：AI 之星" /></div>
      <div class="field"><label>天数（默认 30，上限 365）</label><input id="ao-title-days" type="number" value="30" /></div>
      <div class="modal-actions">
        <button class="btn" id="ao-title-cancel">取消</button>
        <button class="btn btn-primary" id="ao-title-save">发放</button>
      </div>`);
    document.getElementById('ao-title-cancel').onclick = closeModal;
    document.getElementById('ao-title-save').onclick = async () => {
      const errEl = document.getElementById('ao-title-error');
      errEl.classList.remove('show');
      try {
        await API.post('/api/admin/titles', JSON.stringify({
          user_id: parseInt(document.getElementById('ao-title-uid').value, 10),
          title: document.getElementById('ao-title-text').value.trim(),
          days: parseInt(document.getElementById('ao-title-days').value, 10) || 30,
        }));
        closeModal();
        toast('已发放');
        fetchPurchases(document.getElementById('ao-status').value);
      } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
    };
  }

  // ---- 评委评审独立页（#/admin/judge）：选作品 → 4 维度打分 → 自动折算发放 ----
  async function loadJudge() {
    content.innerHTML = `
      <div class="card" style="padding:16px 18px;margin-bottom:14px;">
        <div class="file-list-head"><span>🧑‍⚖️ 评审打分（创意30% · 内容25% · 完成25% · 价值观20%｜满分 300⭐｜综合 &lt;6 不兑现）</span></div>
        <div class="form-error" id="aj-error" style="margin-top:6px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
          <select id="aj-type" style="padding:9px;border:1px solid var(--border);border-radius:10px;font-size:14px;">
            <option value="file">文件</option><option value="app">轻应用</option>
          </select>
          <div style="position:relative;flex:1;min-width:200px;">
            <input id="aj-search" type="text" autocomplete="off" placeholder="输入作品标题 / 文件名 / 作者搜索…" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
            <input id="aj-ref-id" type="hidden" />
            <div id="aj-dropdown" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;max-height:220px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);display:none;"></div>
          </div>
        </div>
        <div id="aj-selected" style="font-size:13px;color:var(--text-dim);margin-bottom:10px;"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;">
          ${JUDGE_DIMS.map((d) => `
          <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--bg);">
            <span style="flex:1;font-size:12.5px;color:var(--text-dim);">${d.label}<br><span style="color:var(--text);font-weight:600;">${Math.round(d.weight * 100)}%</span></span>
            <input id="aj-${d.key}" type="number" min="0" max="10" step="1" placeholder="0-10" style="width:64px;padding:7px 8px;border:1px solid var(--border);border-radius:10px;font-size:14px;text-align:center;" />
          </div>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="font-size:15px;font-weight:700;color:var(--primary);" id="aj-preview">请选择作品并输入分数</div>
          <button class="btn btn-primary btn-sm" id="aj-save" style="margin-left:auto;">提交评审并发放</button>
        </div>
      </div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="file-list-head"><span>📋 待评审作品（近期未评审）</span></div>
        <div id="aj-pending"><div class="spinner"></div></div>
      </div>
      <div class="card" style="padding:14px 16px;">
        <div class="file-list-head"><span>✅ 已评审记录（可重新评审，自动补/扣差额积分）</span></div>
        <div id="aj-done"><div class="spinner"></div></div>
      </div>`;

    const searchEl = document.getElementById('aj-search');
    const refIdEl = document.getElementById('aj-ref-id');
    const ddEl = document.getElementById('aj-dropdown');
    const selEl = document.getElementById('aj-selected');
    const typeEl = document.getElementById('aj-type');
    const previewEl = document.getElementById('aj-preview');
    const errEl = document.getElementById('aj-error');
    const saveBtn = document.getElementById('aj-save');
    let timer = null;
    let curRef = null;

    const closeDd = () => { ddEl.style.display = 'none'; };
    const calc = () => {
      let t = 0, valid = true;
      for (const d of JUDGE_DIMS) {
        const el = document.getElementById('aj-' + d.key);
        const v = el ? parseInt(el.value, 10) : NaN;
        if (Number.isNaN(v) || v < 0 || v > 10) { valid = false; break; }
        t += v * d.weight;
      }
      if (!valid) { previewEl.textContent = '请完整输入 0-10 的整数分数'; return; }
      t = Math.round(t * 100) / 100;
      const pts = t < 6 ? 0 : Math.round(Math.round(t * 100) * 30 / 100);
      previewEl.textContent = `综合 ${t.toFixed(2)} / 10 分 → 评审积分 ${pts} ⭐${t < 6 ? '（低于 6 分不兑现）' : ''}`;
    };
    JUDGE_DIMS.forEach((d) => {
      const el = document.getElementById('aj-' + d.key);
      el.addEventListener('input', calc);
    });

    const renderDd = (items) => {
      if (!items.length) {
        ddEl.innerHTML = '<div style="padding:10px 12px;color:var(--text-dim);font-size:13px;">无匹配结果</div>';
        ddEl.style.display = 'block';
        return;
      }
      ddEl.innerHTML = items.map((it) => `
        <div data-id="${it.id}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" onmouseover="this.style.background='var(--primary-soft)'" onmouseout="this.style.background=''">
          <div style="font-weight:600;">${escapeHtml(it.name)}</div>
          <div style="color:var(--text-dim);font-size:12px;margin-top:1px;">${escapeHtml(it.meta)} · id=${it.id}</div>
        </div>`).join('');
      ddEl.style.display = 'block';
      ddEl.querySelectorAll('[data-id]').forEach((el) => {
        el.onclick = () => selectItem(items.find((x) => String(x.id) === el.dataset.id));
      });
    };
    const doSearch = async () => {
      const kw = searchEl.value.trim();
      if (!kw) { closeDd(); return; }
      const type = typeEl.value;
      try {
        const url = type === 'file'
          ? '/api/admin/files?q=' + encodeURIComponent(kw)
          : '/api/admin/apps?q=' + encodeURIComponent(kw);
        const data = await API.get(url);
        const items = (type === 'file' ? data.files : data.apps || []).map((x) => ({
          id: x.id,
          name: type === 'file' ? (x.title && x.title.trim() ? x.title : x.original_name) : x.title,
          meta: `${x.class_name || ''}班 ${x.real_name || ''}${type === 'file' && x.original_name ? ' · ' + x.original_name : ''}`,
        }));
        renderDd(items);
      } catch (_) { closeDd(); }
    };
    const selectItem = async (item) => {
      curRef = { ref_type: typeEl.value, ref_id: item.id };
      refIdEl.value = item.id;
      selEl.textContent = `已选择：#${item.id} ${item.name}（${item.meta}）`;
      searchEl.value = item.name;
      closeDd();
      JUDGE_DIMS.forEach((d) => { document.getElementById('aj-' + d.key).value = ''; });
      try {
        const r = await API.get('/api/admin/judge?ref_type=' + curRef.ref_type + '&ref_id=' + curRef.ref_id);
        if (r.review) {
          const sc = (() => { try { return JSON.parse(r.review.scores); } catch (_) { return {}; } })();
          JUDGE_DIMS.forEach((d) => {
            const el = document.getElementById('aj-' + d.key);
            if (sc[d.key] != null) el.value = sc[d.key];
          });
          selEl.textContent += `（已评审：综合 ${r.review.total} 分 / +${r.review.points}⭐，重新提交将覆盖并自动补/扣差额）`;
        }
      } catch (_) { /* ignore */ }
      calc();
    };
    searchEl.addEventListener('input', () => { refIdEl.value = ''; selEl.textContent = ''; curRef = null; clearTimeout(timer); timer = setTimeout(doSearch, 250); });
    typeEl.addEventListener('change', () => { refIdEl.value = ''; selEl.textContent = ''; curRef = null; closeDd(); });
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDd(); });
    searchEl.addEventListener('blur', () => setTimeout(closeDd, 150));

    saveBtn.onclick = async () => {
      errEl.classList.remove('show');
      if (!curRef || !parseInt(refIdEl.value, 10)) {
        errEl.textContent = '请先从搜索结果中选择作品';
        errEl.classList.add('show');
        return;
      }
      const scores = {};
      let bad = false;
      JUDGE_DIMS.forEach((d) => {
        const v = parseInt(document.getElementById('aj-' + d.key).value, 10);
        if (Number.isNaN(v) || v < 0 || v > 10) bad = true;
        scores[d.key] = v;
      });
      if (bad) { errEl.textContent = '每个维度请输入 0-10 的整数分数'; errEl.classList.add('show'); return; }
      const yes = await confirm(`确认对「${curRef.ref_type === 'file' ? '文件' : '轻应用'} #${curRef.ref_id}」提交评审？积分将自动发放/调整给作者`);
      if (!yes) return;
      saveBtn.disabled = true;
      saveBtn.textContent = '提交中…';
      try {
        const r = await API.post('/api/admin/judge', JSON.stringify({
          ref_type: curRef.ref_type, ref_id: curRef.ref_id, scores,
        }));
        toast(r.message || '已提交');
        errEl.classList.remove('show');
        loadJudge(); // 刷新待评审/已评审列表与表单
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('show');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = '提交评审并发放';
    };

    // 待评审列表
    (async () => {
      const box = document.getElementById('aj-pending');
      let data;
      try { data = await API.get('/api/admin/judge?pending=1&limit=30'); }
      catch (e) { box.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; return; }
      const list = data.pending || [];
      if (!list.length) { box.innerHTML = '<div class="empty" style="padding:8px 0;">全部作品都已评审 🎉</div>'; return; }
      box.innerHTML = list.map((p) => `
        <div class="file-row">
          <div class="file-info">
            <div class="file-name" style="font-size:13px;">${escapeHtml(p.title)} <span class="audit-tag">${p.ref_type === 'file' ? '文件' : '轻应用'}#${p.ref_id}</span></div>
            <div class="file-meta">${escapeHtml(p.owner || '')}${p.class_name ? ' · ' + escapeHtml(p.class_name) + '班' : ''} · ${formatTime(p.time)}</div>
          </div>
          <button class="btn btn-sm btn-primary" data-go="${p.ref_type}:${p.ref_id}">去评审</button>
        </div>`).join('');
      box.querySelectorAll('[data-go]').forEach((b) => {
        b.onclick = () => {
          const [t, id] = b.dataset.go.split(':');
          typeEl.value = t;
          searchEl.value = '#' + id;
          refIdEl.value = id;
          curRef = { ref_type: t, ref_id: Number(id) };
          selEl.textContent = '已从待评审列表选择 #' + id + '，正在加载…';
          closeDd();
          // 直接按 id 拉详情回填（走搜索接口按 id 找标题）
          (async () => {
            const url = t === 'file' ? '/api/admin/files?q=' + encodeURIComponent('#' + id) : '/api/admin/apps?q=' + encodeURIComponent('#' + id);
            let found = null;
            try {
              const data = await API.get(url);
              const arr = t === 'file' ? data.files : data.apps || [];
              found = arr.find((x) => String(x.id) === String(id));
            } catch (_) { /* ignore */ }
            const name = found ? (t === 'file' ? (found.title || found.original_name) : found.title) : ('作品 #' + id);
            const meta = found ? `${found.class_name || ''}班 ${found.real_name || ''}` : '';
            searchEl.value = name;
            selEl.textContent = `已选择：#${id} ${name}（${meta}）`;
            JUDGE_DIMS.forEach((d) => { document.getElementById('aj-' + d.key).value = ''; });
            calc();
          })();
        };
      });
    })();

    // 已评审列表
    (async () => {
      const box = document.getElementById('aj-done');
      let data;
      try { data = await API.get('/api/admin/judge?limit=20'); }
      catch (e) { box.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; return; }
      const list = data.reviews || [];
      if (!list.length) { box.innerHTML = '<div class="empty" style="padding:8px 0;">暂无评审记录</div>'; return; }
      box.innerHTML = list.map((r) => {
        const title = r.ref_type === 'file' ? (r.file_title || '#file') : (r.app_title || '#app');
        return `
        <div class="file-row">
          <div class="file-info">
            <div class="file-name" style="font-size:13px;">${escapeHtml(title)} <span class="audit-tag">${r.ref_type === 'file' ? '文件' : '轻应用'}#${r.ref_id}</span> <span class="audit-tag">综合 ${r.total} 分</span></div>
            <div class="file-meta">${escapeHtml(r.owner_name || '')}${r.class_name ? ' · ' + escapeHtml(r.class_name) + '班' : ''} · 评审积分 +${r.points}⭐ · ${formatTime(r.updated_at)}</div>
          </div>
          <button class="btn btn-sm btn-ghost" data-rejudge="${r.ref_type}:${r.ref_id}">重新评审</button>
        </div>`;
      }).join('');
      box.querySelectorAll('[data-rejudge]').forEach((b) => {
        b.onclick = () => {
          const [t, id] = b.dataset.rejudge.split(':');
          typeEl.value = t;
          searchEl.value = '#' + id;
          refIdEl.value = id;
          curRef = { ref_type: t, ref_id: Number(id) };
          closeDd();
          (async () => {
            const r = await API.get('/api/admin/judge?ref_type=' + t + '&ref_id=' + id).catch(() => null);
            if (r && r.review) {
              const sc = (() => { try { return JSON.parse(r.review.scores); } catch (_) { return {}; } })();
              JUDGE_DIMS.forEach((d) => {
                const el = document.getElementById('aj-' + d.key);
                if (sc[d.key] != null) el.value = sc[d.key];
              });
            }
            selEl.textContent = '已加载评审记录，可直接修改后重新提交（自动补/扣差额）';
            calc();
            document.getElementById('aj-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
          })();
        };
      });
    })();
  }

  async function toggleShop() {
    let data;
    try { data = await API.get('/api/admin/settings'); } catch (err) { toast(err.message); return; }
    const cur = data.settings && data.settings.shop_enabled;
    const next = cur === '1' ? '0' : '1';
    const yes = await confirm(`当前商城开关：${cur === '1' ? '开' : '关'}。确定${next === '1' ? '开启' : '关闭'}？`);
    if (!yes) return;
    try {
      await API.request('/api/admin/settings/shop_enabled', { method: 'PUT', body: JSON.stringify({ value: next }) });
      toast('商城已' + (next === '1' ? '开启' : '关闭'));
    } catch (err) { toast(err.message); }
  }

  // ---------- 运维（存储/会话）----------
  async function loadStorage() {
    content.innerHTML = `<div class="spinner"></div>`;
    let s, sessions;
    try {
      [s, sessions] = await Promise.all([API.get('/api/admin/storage'), API.get('/api/admin/sessions')]);
    } catch (err) { content.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const byClass = s.by_class || [];
    const bigFiles = s.big_files || [];
    const sessList = (sessions && sessions.sessions) || [];
    content.innerHTML = `
      <div class="card" style="padding:12px 14px;margin-bottom:14px;">
        <b>存储总览</b>：文件 ${(s.totals || {}).files} 个 · 占用 ${formatSize((s.totals || {}).bytes)} · 磁盘剩余 ${s.disk_free_bytes != null ? formatSize(s.disk_free_bytes) : '-'}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:14px;" id="as-class"></div>
      <div class="card" style="padding:12px 14px;">
        <div class="file-list-head"><span> 大文件 TOP20</span></div>
        ${bigFiles.length ? bigFiles.map((f) => `
          <div class="file-row">
            <div class="file-info">
              <div class="file-name">${escapeHtml(f.original_name)}</div>
              <div class="file-meta">${f.class_name}班 ${escapeHtml(f.real_name || '')} · ${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
            </div>
          </div>`).join('') : `<div class="empty">暂无</div>`}
      </div>
      <div class="card" style="padding:12px 14px;margin-top:14px;">
        <div class="file-list-head"><span>QQ 会话（${sessList.length} 个）</span></div>
        <div id="as-sessions">${renderSessions(sessList)}</div>
      </div>`;
    document.getElementById('as-class').innerHTML =
      `<div class="card" style="grid-column:1/-1;padding:12px 14px;"><b> 按班级占用</b></div>` +
      (byClass.length ? byClass.map((c) => `
        <div class="card" style="padding:10px 14px;">
          <div style="font-size:15px;font-weight:600;">${escapeHtml(c.class_name || '其他')}班</div>
          <div style="font-size:12px;color:var(--text-dim);">${c.users} 人 · ${c.files} 文件 · ${formatSize(c.bytes)}</div>
        </div>`).join('') : `<div class="empty">暂无</div>`);
    bindSessionButtons();
  }

  function renderSessions(sessions) {
    if (!sessions.length) return `<div class="empty">无活跃会话</div>`;
    return sessions.map((s) => `
      <div class="file-row">
        <div class="file-info">
          <div class="file-name">${escapeHtml(s.nickname || '(未命名)')} ${s.token_obtained ? '<span class="audit-tag" style="color:var(--success);">已授权</span>' : '<span class="audit-tag">未授权</span>'}</div>
          <div class="file-meta">${s.sessionId} · tiny=${escapeHtml(s.tiny_id || '')} · 最近活跃 ${s.last_active ? formatTime(new Date(s.last_active)) : '-'}</div>
        </div>
        <div class="file-actions"><button class="btn btn-sm btn-ghost" data-sess="${s.sessionId}" style="color:var(--danger);">失效</button></div>
      </div>`).join('');
  }

  function bindSessionButtons() {
    const sessEl = document.getElementById('as-sessions');
    if (!sessEl) return;
    sessEl.querySelectorAll('[data-sess]').forEach((b) => {
      b.onclick = async () => {
        const yes = await confirm('确定使该 QQ 会话失效？（删除会话 token，相关用户需重新扫码）', { danger: true });
        if (!yes) return;
        try { await API.post('/api/admin/sessions/' + b.dataset.sess + '/invalidate', '{}'); toast('已失效'); loadStorage(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  // ---------- 教程（学AI 在线编辑）----------
  async function loadArticles() {
    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm btn-primary" id="ar-new">＋ 新建教程</button>
        <span style="font-size:12px;color:var(--text-dim);align-self:center;">在线编辑后以数据库为准；保存不动学员任务进度</span>
      </div>
      <div id="ar-list"><div class="spinner"></div></div>`;
    document.getElementById('ar-new').onclick = () => { location.hash = '#/admin/articles/new'; };
    fetchArticles();
  }

  async function fetchArticles() {
    const list = document.getElementById('ar-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/articles'); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const rows = data.articles || [];
    if (!rows.length) { list.innerHTML = `<div class="empty">还没有教程，点「新建教程」创建</div>`; return; }
    let curChapter = -1;
    list.innerHTML = rows.map((a) => {
      let head = '';
      if (a.chapter !== curChapter) { curChapter = a.chapter; head = `<div class="card" style="padding:10px 14px;margin-bottom:8px;"><b>第 ${a.chapter} 章</b></div>`; }
      return head + `
      <div class="card" style="padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div>
            <div class="file-name" style="font-size:15px;">${escapeHtml(a.title)} <span class="audit-tag">${escapeHtml(a.slug)}</span></div>
            <div class="file-meta" style="font-size:12px;color:var(--text-dim);margin-top:4px;">id=${a.id} · 排序 ${a.sort_order} · 更新 ${formatTime(a.updated_at)}${a.summary ? ' · ' + escapeHtml(a.summary) : ''}</div>
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-ghost" data-edit="${a.id}">编辑</button>
            <button class="btn btn-sm btn-ghost" data-del="${a.id}" data-name="${escapeHtml(a.title)}" style="color:var(--danger);">删除</button>
          </div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { location.hash = '#/admin/articles/edit/' + b.dataset.edit; }; });
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const yes = await confirm(`确定删除教程「${b.dataset.name}」吗？（学员任务进度一并清除）`, { danger: true });
        if (!yes) return;
        try { await API.del('/api/admin/articles/' + b.dataset.del); toast('已删除'); fetchArticles(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  // 独立教程编辑页：左表单右实时预览（桌面双栏 / 移动单栏），Ctrl+S 保存
  function renderArticleEditor(id) {
    const isEdit = !!id;
    content.innerHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <button class="btn btn-ghost btn-sm" id="ae-back">← 返回列表</button>
            <h2 style="margin:0;font-size:18px;">${isEdit ? '编辑教程' : '新建教程'}</h2>
          </div>
          <button class="btn btn-primary" id="ae-save">保存</button>
        </div>
        <div class="form-error" id="ae-error"></div>
        <div class="ae-grid">
          <div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="field"><label>slug（URL 标识，字母数字连字符）</label><input id="ae-slug" type="text" maxlength="64" placeholder="如 ai-intro" /></div>
              <div class="field"><label>章节号</label><input id="ae-chapter" type="number" value="1" /></div>
            </div>
            <div class="field"><label>标题</label><input id="ae-title" type="text" maxlength="128" placeholder="教程标题" /></div>
            <div class="field"><label>一句话简介</label><input id="ae-summary" type="text" maxlength="300" /></div>
            <div class="field">
              <label>正文（Markdown，支持标题/列表/引用/代码块/表格/链接）</label>
              <textarea id="ae-content" rows="18" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:13px;font-family:ui-monospace,monospace;line-height:1.7;" placeholder="支持标题/列表/引用/代码块/表格/链接"></textarea>
            </div>
            <div class="field">
              <label>任务（JSON 数组）</label>
              <textarea id="ae-tasks" rows="6" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:12px;font-family:ui-monospace,monospace;" placeholder='[{"type":"quiz","question":"...","options":["A","B"],"answer":0}]'></textarea>
            </div>
            <div class="field"><label>排序</label><input id="ae-sort" type="number" value="0" /></div>
          </div>
          <div>
            <div style="font-weight:600;margin-bottom:8px;">实时预览</div>
            <div id="ae-preview" class="card learn-article-body" style="padding:16px;min-height:300px;max-height:calc(100vh - 240px);overflow-y:auto;"></div>
          </div>
        </div>
      </div>`;

    const errEl = document.getElementById('ae-error');
    const saveBtn = document.getElementById('ae-save');
    const doPreview = () => {
      const box = document.getElementById('ae-preview');
      if (!box) return;
      box.innerHTML = (typeof renderMarkdown === 'function')
        ? renderMarkdown(document.getElementById('ae-content').value)
        : '<div class="empty">渲染器不可用</div>';
    };
    let aeTimer = null;
    document.getElementById('ae-content').addEventListener('input', () => {
      clearTimeout(aeTimer);
      aeTimer = setTimeout(doPreview, 300);
    });
    document.getElementById('ae-back').onclick = () => { location.hash = '#/admin/articles'; };

    const doSave = async () => {
      errEl.classList.remove('show');
      const body = JSON.stringify({
        slug: document.getElementById('ae-slug').value.trim(),
        chapter: parseInt(document.getElementById('ae-chapter').value, 10),
        title: document.getElementById('ae-title').value.trim(),
        summary: document.getElementById('ae-summary').value.trim(),
        content: document.getElementById('ae-content').value,
        tasks: document.getElementById('ae-tasks').value.trim(),
        sort_order: parseInt(document.getElementById('ae-sort').value, 10) || 0,
      });
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        if (isEdit) await API.request('/api/admin/articles/' + id, { method: 'PUT', body });
        else await API.post('/api/admin/articles', body);
        toast('已保存');
        location.hash = '#/admin/articles';
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    };
    saveBtn.onclick = doSave;
    // Ctrl/Cmd+S 保存（编辑器不存在时自动失效）
    document.addEventListener('keydown', function aeKey(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && document.getElementById('ae-save')) {
        e.preventDefault();
        document.getElementById('ae-save').click();
      }
    });

    if (isEdit) {
      API.get('/api/admin/articles/' + id).then((d) => {
        const a = d.article || {};
        document.getElementById('ae-slug').value = a.slug || '';
        document.getElementById('ae-chapter').value = a.chapter != null ? a.chapter : 1;
        document.getElementById('ae-title').value = a.title || '';
        document.getElementById('ae-summary').value = a.summary || '';
        document.getElementById('ae-content').value = a.content || '';
        document.getElementById('ae-tasks').value = (typeof a.tasks === 'string' ? a.tasks : JSON.stringify(a.tasks || [], null, 2));
        document.getElementById('ae-sort').value = a.sort_order != null ? a.sort_order : 0;
        doPreview();
      }).catch((err) => toast(err.message));
    } else {
      doPreview();
    }
  }

  // ---------- 设置 ----------
  async function loadSettings() {
    content.innerHTML = `<div class="spinner"></div>`;
    let data;
    try { data = await API.get('/api/admin/settings'); }
    catch (err) { content.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const s = data.settings || {};
    const known = [
      ['shop_enabled', '积分商城开关', s.shop_enabled === '1', '控制积分商城前端入口（当前前端未上架，开关预留给未来）'],
      ['audit_enabled', 'AI 内容审核开关', s.audit_enabled !== '0', '关闭后文本/代码上传跳过 DeepSeek 审核（默认随 DEEPSEEK_AUDIT 环境变量）'],
    ];
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;" id="as-cards"></div>
      <div class="card" style="padding:12px 14px;margin-top:14px;">
        <div class="file-list-head"><span>所有已存设置</span></div>
        <div id="as-all"><div class="empty">暂无</div></div>
      </div>`;
    document.getElementById('as-cards').innerHTML = known.map(([key, label, on, desc]) => `
      <div class="card" style="padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <div style="font-weight:600;">${label}</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${escapeHtml(desc)}</div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;"><input type="checkbox" data-key="${key}" ${on ? 'checked' : ''} /> ${on ? '开' : '关'}</label>
        </div>
      </div>`).join('');
    const allKeys = Object.keys(s);
    document.getElementById('as-all').innerHTML = allKeys.length
      ? allKeys.map((k) => `<div class="file-row"><div class="file-info"><div class="file-name">${escapeHtml(k)}</div><div class="file-meta">${escapeHtml(s[k])}</div></div></div>`).join('')
      : `<div class="empty">暂无</div>`;
    document.querySelectorAll('#as-cards input[data-key]').forEach((cb) => {
      cb.onchange = async () => {
        const key = cb.dataset.key;
        const value = cb.checked ? (key === 'shop_enabled' ? '1' : '1') : '0';
        try {
          await API.request('/api/admin/settings/' + key, { method: 'PUT', body: JSON.stringify({ value }) });
          toast('已更新');
          loadSettings();
        } catch (err) { toast(err.message); cb.checked = !cb.checked; }
      };
    });
  }

  // ---------- 审计 ----------
  async function loadLogs() {
    content.innerHTML = `
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="file-list-head"><span>📋 内容审查记录（AI 拒绝的展示文本，O3）</span></div>
        <div id="al-audit-list"><div class="spinner"></div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="al-q" type="text" placeholder="搜索操作类型/详情" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;" />
        <button class="btn btn-sm" id="al-search">搜索</button>
      </div>
      <div id="al-list"><div class="spinner"></div></div>`;
    const doSearch = () => fetchLogs(document.getElementById('al-q').value.trim());
    document.getElementById('al-search').onclick = doSearch;
    document.getElementById('al-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    fetchAuditLogs();
    doSearch();
  }

  async function fetchAuditLogs() {
    const list = document.getElementById('al-audit-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/audit-logs?limit=20'); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const logs = data.logs || [];
    if (!logs.length) { list.innerHTML = `<div class="empty" style="padding:6px 0;">暂无审查拒绝记录</div>`; return; }
    const kindLabel = { display_text: '作品信息审查', file_scan: '恶意扫描' };
    list.innerHTML = logs.map((l) => `
      <div class="file-row">
        <div class="file-info">
          <div class="file-name" style="font-size:13px;">${escapeHtml(kindLabel[l.kind] || l.kind)} <span class="audit-tag">${escapeHtml(l.ref_type || '-')}${l.ref_id ? '#' + l.ref_id : ''}</span> ${l.user_id ? '<span class="audit-tag">uid=' + l.user_id + '</span>' : ''} <span class="audit-tag" style="color:${l.result === 'rejected' ? 'var(--danger)' : 'var(--success)'};">${escapeHtml(l.result)}</span></div>
          <div class="file-meta">${formatTime(l.created_at)} · ${escapeHtml(l.reason || '')}</div>
          <div class="file-meta" style="font-size:12px;color:var(--text-dim);">${escapeHtml(l.content || '')}</div>
        </div>
      </div>`).join('');
  }

  async function fetchLogs(q) {
    const list = document.getElementById('al-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/admin/logs' + (q ? '?q=' + encodeURIComponent(q) : '')); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const logs = data.logs || [];
    if (!logs.length) { list.innerHTML = `<div class="empty">没有审计记录</div>`; return; }
    list.innerHTML = `<div class="card" style="padding:12px 14px;"><div class="file-list-head"><span>共 ${logs.length} 条操作记录</span></div>` +
      logs.map((l) => `
      <div class="file-row">
        <div class="file-info">
          <div class="file-name" style="font-size:14px;">${escapeHtml(l.action)} <span class="audit-tag">${escapeHtml(l.target_type || '-')}${l.target_id ? '#' + l.target_id : ''}</span></div>
          <div class="file-meta">${escapeHtml(l.admin_name || '')} (id=${l.admin_id}) · ${formatTime(l.created_at)} · ${escapeHtml(l.ip || '')}</div>
          ${l.detail ? `<div class="file-meta" style="font-size:12px;color:var(--text-dim);">${escapeHtml(l.detail)}</div>` : ''}
        </div>
      </div>`).join('') + `</div>`;
  }
};
