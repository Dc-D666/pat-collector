'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function displayNameOf(row, viewerClass) {
  // 未授权展示真实姓名 → 用昵称（无昵称兜底真实姓名）
  // P1（2026-08-15）：真实姓名仅对同班同学展示；非同班/非本校一律显示昵称（拼音缩写）
  const isSameClass = viewerClass && row.class_name === viewerClass;
  // 非同班兜底「同学」：无昵称也不泄露真实姓名（P1）
  return (row.show_real_name !== 0 && isSameClass) ? row.real_name : (row.nickname || '同学');
}

function groupByStudent(fileRows, appRows, linkRows, titleMap, viewerClass) {
  const map = new Map();
  const init = (r) => {
    if (!map.has(r.user_id)) {
      map.set(r.user_id, {
        user_id: r.user_id,
        real_name: r.real_name,
        display_name: displayNameOf(r, viewerClass),
        title_tag: (titleMap && titleMap.get(r.user_id)) || '',
        files: [],
        apps: [],
        links: [],
      });
    }
    return map.get(r.user_id);
  };
  for (const r of fileRows) {
    init(r).files.push({
      id: r.file_id,
      original_name: r.original_name,
      title: r.title || null,
      size: r.size,
      uploaded_at: r.uploaded_at,
    });
  }
  for (const r of appRows) {
    init(r).apps.push({
      id: r.app_id,
      title: r.title,
      app_url: r.app_url,
      description: r.description,
      gameplay: r.gameplay,
      created_at: r.created_at,
    });
  }
  for (const r of linkRows || []) {
    init(r).links.push({
      id: r.link_id,
      title: r.title,
      url: r.url,
      description: r.description,
      verified: r.verified,
      created_at: r.created_at,
    });
  }
  return [...map.values()].map((s) => {
    let last = null;
    for (const f of s.files) {
      if (f.uploaded_at && (last === null || f.uploaded_at > last)) last = f.uploaded_at;
    }
    for (const a of s.apps) {
      if (a.created_at && (last === null || a.created_at > last)) last = a.created_at;
    }
    for (const l of s.links) {
      if (l.created_at && (last === null || l.created_at > last)) last = l.created_at;
    }
    return {
      user_id: s.user_id,
      display_name: s.display_name,
      title_tag: s.title_tag,
      file_count: s.files.length,
      app_count: s.apps.length,
      link_count: s.links.length,
      last_submit: last,
      files: s.files,
      apps: s.apps,
      links: s.links,
    };
  });
}

// 全校作品展：所有班级的项目平铺展示（文件 + 轻应用），每项带班级 tag 信息
router.get(
  '/wall',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [fileRows, appRows, linkRows] = await Promise.all([
      query(
        // R2-5：仅展示已过审（reviewed）文件——pending 待审/flagged 违规均不公开；
        // R2-6：排除停用用户（u.status = 'active'）
        `SELECT u.id AS user_id, u.class_name, u.real_name, u.show_real_name, u.nickname,
                f.id AS file_id, f.original_name, f.title, f.description, f.gameplay, f.size, f.uploaded_at, f.source
         FROM users u
         JOIN files f ON f.user_id = u.id AND f.audit_status = 'reviewed' AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'`
      ),
      query(
        `SELECT u.id AS user_id, u.class_name, u.real_name, u.show_real_name, u.nickname,
                a.id AS app_id, a.app_url, a.title, a.description, a.gameplay, a.created_at
         FROM users u
         JOIN apps a ON a.user_id = u.id AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'`
      ),
      query(
        `SELECT u.id AS user_id, u.class_name, u.real_name, u.show_real_name, u.nickname,
                l.id AS link_id, l.url, l.title, l.description, l.owner, l.repo, l.verified, l.created_at
         FROM users u
         JOIN links l ON l.user_id = u.id AND l.verified = 1 AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'`
      ),
    ]);

    // 点赞聚合 + 我的点赞 + 作品展置顶（purchases）+ 生效中的专属称号
    const [likeAgg, myLikes, tops, titles] = await Promise.all([
      query('SELECT target_type, target_id, COUNT(*) AS cnt FROM likes GROUP BY target_type, target_id'),
      query('SELECT target_type, target_id FROM likes WHERE user_id = ?', [req.user.id]),
      query(
        "SELECT ref_type, ref_id FROM purchases WHERE item = 'wall_top' AND status = 'active' AND expires_at > NOW()"
      ),
      query(
        "SELECT user_id, title FROM purchases WHERE item = 'title' AND status = 'active' AND expires_at > NOW()"
      ),
    ]);
    const likeMap = new Map();
    for (const l of likeAgg) likeMap.set(l.target_type + ':' + l.target_id, Number(l.cnt));
    const likedSet = new Set(myLikes.map((l) => l.target_type + ':' + l.target_id));
    const topSet = new Set(tops.map((t) => t.ref_type + ':' + t.ref_id));
    const titleMap = new Map(titles.map((t) => [t.user_id, t.title]));

    const projects = [];
    for (const r of fileRows) {
      projects.push({
        type: 'file',
        id: r.file_id,
        user_id: r.user_id,
        class_name: r.class_name,
        grade: config.gradeOf(r.class_name),
        display_name: displayNameOf(r, req.user.class_name),
        title_tag: titleMap.get(r.user_id) || '',
        title: r.title || r.original_name,
        original_name: r.original_name,
        source: r.source || '',
        description: r.description,
        gameplay: r.gameplay,
        size: r.size,
        time: r.uploaded_at,
        is_mine: r.user_id === req.user.id,
        same_class: r.class_name === req.user.class_name,
        like_count: likeMap.get('file:' + r.file_id) || 0,
        liked_by_me: likedSet.has('file:' + r.file_id),
        topped: topSet.has('file:' + r.file_id),
      });
    }
    for (const r of appRows) {
      projects.push({
        type: 'app',
        id: r.app_id,
        user_id: r.user_id,
        class_name: r.class_name,
        grade: config.gradeOf(r.class_name),
        display_name: displayNameOf(r, req.user.class_name),
        title_tag: titleMap.get(r.user_id) || '',
        title: r.title || 'AI 轻应用',
        app_url: r.app_url,
        description: r.description,
        gameplay: r.gameplay,
        time: r.created_at,
        is_mine: r.user_id === req.user.id,
        same_class: r.class_name === req.user.class_name,
        like_count: likeMap.get('app:' + r.app_id) || 0,
        liked_by_me: likedSet.has('app:' + r.app_id),
        topped: topSet.has('app:' + r.app_id),
      });
    }
    for (const r of linkRows) {
      projects.push({
        type: 'link',
        id: r.link_id,
        user_id: r.user_id,
        class_name: r.class_name,
        grade: config.gradeOf(r.class_name),
        display_name: displayNameOf(r, req.user.class_name),
        title_tag: titleMap.get(r.user_id) || '',
        title: r.title || (r.repo || 'GitHub 项目'),
        url: r.url,
        owner: r.owner,
        repo: r.repo,
        description: r.description,
        time: r.created_at,
        is_mine: r.user_id === req.user.id,
        same_class: r.class_name === req.user.class_name,
        like_count: likeMap.get('link:' + r.link_id) || 0,
        liked_by_me: likedSet.has('link:' + r.link_id),
        topped: topSet.has('link:' + r.link_id),
      });
    }
    // 排序：置顶项优先，其余按时间倒序
    projects.sort((a, b) => {
      if (a.topped !== b.topped) return a.topped ? -1 : 1;
      return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
    });

    res.json({ class_name: req.user.class_name, projects });
  })
);

// 全校提交总览
router.get(
  '/overview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [fileRows, appRows, linkRows] = await Promise.all([
      query(
        // R2-5/R2-6：仅已过审文件 + 仅活跃用户
        `SELECT u.class_name, u.id AS user_id, u.real_name, u.show_real_name, u.nickname,
                f.id AS file_id, f.original_name, f.title, f.size, f.uploaded_at
         FROM users u
         JOIN files f ON f.user_id = u.id AND f.audit_status = 'reviewed' AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'
         ORDER BY u.class_name ASC, u.real_name ASC, f.uploaded_at DESC, f.id DESC`
      ),
      query(
        `SELECT u.class_name, u.id AS user_id, u.real_name, u.show_real_name, u.nickname,
                a.id AS app_id, a.app_url, a.title, a.description, a.gameplay, a.created_at
         FROM users u
         JOIN apps a ON a.user_id = u.id AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'
         ORDER BY u.class_name ASC, u.real_name ASC, a.created_at DESC, a.id DESC`
      ),
      query(
        `SELECT u.class_name, u.id AS user_id, u.real_name, u.show_real_name, u.nickname,
                l.id AS link_id, l.url, l.title, l.description, l.verified, l.created_at
         FROM users u
         JOIN links l ON l.user_id = u.id AND l.verified = 1 AND u.qq_tiny_id IS NOT NULL AND u.status = 'active'
         ORDER BY u.class_name ASC, u.real_name ASC, l.created_at DESC, l.id DESC`
      ),
    ]);

    let totalFiles = 0;
    let totalSize = 0;
    let totalApps = 0;
    let totalLinks = 0;
    const classMap = new Map();

    for (const r of fileRows) {
      totalFiles += 1;
      totalSize += Number(r.size);
      if (!classMap.has(r.class_name)) {
        classMap.set(r.class_name, { class_name: r.class_name, fileRows: [], appRows: [], linkRows: [] });
      }
      classMap.get(r.class_name).fileRows.push(r);
    }
    for (const r of appRows) {
      totalApps += 1;
      if (!classMap.has(r.class_name)) {
        classMap.set(r.class_name, { class_name: r.class_name, fileRows: [], appRows: [], linkRows: [] });
      }
      classMap.get(r.class_name).appRows.push(r);
    }
    for (const r of linkRows) {
      totalLinks += 1;
      if (!classMap.has(r.class_name)) {
        classMap.set(r.class_name, { class_name: r.class_name, fileRows: [], appRows: [], linkRows: [] });
      }
      classMap.get(r.class_name).linkRows.push(r);
    }

    const titles = await query(
      "SELECT user_id, title FROM purchases WHERE item = 'title' AND status = 'active' AND expires_at > NOW()"
    );
    const titleMap = new Map(titles.map((t) => [t.user_id, t.title]));

    const classes = [...classMap.values()].map((c) => {
      const students = groupByStudent(c.fileRows, c.appRows, c.linkRows, titleMap, req.user.class_name);
      const fileCount = students.reduce((n, s) => n + s.file_count, 0);
      const appCount = students.reduce((n, s) => n + s.app_count, 0);
      const linkCount = students.reduce((n, s) => n + s.link_count, 0);
      const size = students.reduce(
        (n, s) => n + s.files.reduce((m, f) => m + Number(f.size), 0),
        0
      );
      let last = null;
      for (const s of students) {
        if (s.last_submit && (last === null || s.last_submit > last)) last = s.last_submit;
      }
      return {
        class_name: c.class_name,
        grade: config.gradeOf(c.class_name),
        student_count: students.length,
        file_count: fileCount,
        app_count: appCount,
        link_count: linkCount,
        total_size: size,
        last_submit: last,
        students: students.map((s) => ({
          user_id: s.user_id,
          // 只返回展示名（尊重展示名授权），不泄露真实姓名
          display_name: s.display_name,
          title_tag: s.title_tag,
          file_count: s.file_count,
          app_count: s.app_count,
          link_count: s.link_count,
          total_size: s.files.reduce((m, f) => m + Number(f.size), 0),
          last_submit: s.last_submit,
          files: s.files,
          apps: s.apps,
          links: s.links,
        })),
      };
    });

    res.json({
      stats: {
        total_classes: config.classes.length,
        classes_with_submissions: classes.length,
        total_files: totalFiles,
        total_size: totalSize,
        total_apps: totalApps,
        total_links: totalLinks,
      },
      classes,
    });
  })
);

module.exports = router;
