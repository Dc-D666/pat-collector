'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function groupByStudent(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.user_id)) {
      map.set(r.user_id, {
        user_id: r.user_id,
        real_name: r.real_name,
        files: [],
      });
    }
    map.get(r.user_id).files.push({
      id: r.file_id,
      original_name: r.original_name,
      size: r.size,
      uploaded_at: r.uploaded_at,
    });
  }
  return [...map.values()].map((s) => {
    let last = null;
    for (const f of s.files) {
      if (f.uploaded_at && (last === null || f.uploaded_at > last)) last = f.uploaded_at;
    }
    return {
      user_id: s.user_id,
      real_name: s.real_name,
      file_count: s.files.length,
      last_submit: last,
      files: s.files,
    };
  });
}

// 班级作品墙：仅本班，按姓名分组，文件倒序
router.get(
  '/wall',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT u.id AS user_id, u.real_name,
              f.id AS file_id, f.original_name, f.size, f.uploaded_at
       FROM users u
       JOIN files f ON f.user_id = u.id
       WHERE u.class_name = ?
       ORDER BY u.real_name ASC, f.uploaded_at DESC, f.id DESC`,
      [req.user.class_name]
    );
    res.json({ class_name: req.user.class_name, students: groupByStudent(rows) });
  })
);

// 全校提交总览
router.get(
  '/overview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT u.class_name, u.id AS user_id, u.real_name,
              f.id AS file_id, f.original_name, f.size, f.uploaded_at
       FROM users u
       JOIN files f ON f.user_id = u.id
       ORDER BY u.class_name ASC, u.real_name ASC, f.uploaded_at DESC, f.id DESC`
    );

    let totalFiles = 0;
    let totalSize = 0;
    const classMap = new Map();

    for (const r of rows) {
      totalFiles += 1;
      totalSize += Number(r.size);
      if (!classMap.has(r.class_name)) {
        classMap.set(r.class_name, { class_name: r.class_name, rows: [] });
      }
      classMap.get(r.class_name).rows.push(r);
    }

    const classes = [...classMap.values()].map((c) => {
      const students = groupByStudent(c.rows);
      const fileCount = students.reduce((n, s) => n + s.file_count, 0);
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
        total_size: size,
        last_submit: last,
        students: students.map((s) => ({
          user_id: s.user_id,
          real_name: s.real_name,
          file_count: s.file_count,
          total_size: s.files.reduce((m, f) => m + Number(f.size), 0),
          last_submit: s.last_submit,
          files: s.files,
        })),
      };
    });

    res.json({
      stats: {
        total_classes: config.classes.length,
        classes_with_submissions: classes.length,
        total_files: totalFiles,
        total_size: totalSize,
      },
      classes,
    });
  })
);

module.exports = router;
