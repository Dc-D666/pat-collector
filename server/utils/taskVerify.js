'use strict';

// 任务完成后端核验（2026-08-21 加固）：
// 此前完成校验全在前端 UI，直接 POST /api/points/task 即可刷完成——这里对可核验的任务类型
// 按任务配置实际校验（与 /api/learn/*-status 检测口径一致），核验不过拒绝记录。
// 无法服务端核验的类型（video 观看、普通自报实操）按自报处理（放行）。
const { getAppPostedStatus, getProjectSubmitted } = require('./learnStatus');
const { hasNftiExperience } = require('./nfti');

// task: 文章 tasks 数组中的单个任务配置；user: req.user；payload: req.body
// 返回 { ok: true } 或 { ok: false, error }
async function verifyTaskCompletion(task, user, payload) {
  if (task.type === 'quiz') {
    // 单选：必须提交所选选项，且与正确答案一致
    const chosen = parseInt(payload && payload.answer, 10);
    if (isNaN(chosen) || chosen !== Number(task.answer)) {
      return { ok: false, error: '回答不正确，无法完成该任务' };
    }
    return { ok: true };
  }
  if (task.type !== 'action') {
    return { ok: true }; // video 等无服务端可核验条件，按自报处理
  }
  if (task.nfti) {
    // NFTI 体验：需 QQ 登录且 nfti 库有测试记录
    if (!user.qq_tiny_id) {
      return { ok: false, error: '该任务需要 QQ 频道登录，请先登录' };
    }
    const experienced = await hasNftiExperience(user.qq_tiny_id);
    if (!experienced) {
      return { ok: false, error: '尚未检测到 NFTI 人格测试记录，请先完成体验' };
    }
    return { ok: true };
  }
  if (task.appcheck) {
    // 第2章：须「频道发帖 + 本站轻应用投稿记录」双条件（2026-08-21 修复）——
    // 仅在频道发过帖（posted）不算完成，必须已自动识别/手动识别投稿到本站（submitted）。
    // 注意：submitted 只统计带来源帖（source_feed_id）的投稿，导入阶段已核验归属，
    // 故 submitted 蕴含 posted；双条件判断是为了与 /api/learn/app-status 口径一致、防误判。
    const st = await getAppPostedStatus(user.id, user);
    if (!st.posted || !st.submitted) {
      return { ok: false, error: '未检测到频道发帖或本站轻应用投稿记录，请先在频道发表 AI 应用，再到「我的项目」→「AI 轻应用」自动识别投稿' };
    }
    return { ok: true };
  }
  if (task.projectcheck) {
    // 第3章：最近 14 天上传过项目文件
    const st = await getProjectSubmitted(user.id);
    if (!st.submitted) {
      return { ok: false, error: '未检测到最近上传的项目文件，请先到「我的项目」上传' };
    }
    return { ok: true };
  }
  if (task.tinyidcheck) {
    // 第5章：提交的 tiny_id 与登录身份一致
    const submitted = String((payload && payload.tiny_id) || '').trim();
    const mine = user.qq_tiny_id;
    if (!submitted || !mine || submitted !== String(mine)) {
      return { ok: false, error: 'tiny_id 与登录身份不一致，无法完成该任务' };
    }
    return { ok: true };
  }
  return { ok: true }; // 普通实操任务：自报完成，无法核验
}

module.exports = { verifyTaskCompletion };
