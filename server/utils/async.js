'use strict';

// 简易异步路由包装，Express 4 无内置 async 错误捕获
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
