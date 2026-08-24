-- AI 小学堂改版一次性迁移（2026-08-25，配合 seed-articles.js 重跑）
-- 在停机/低峰窗口内、跑新代码之前执行。幂等：重复执行无副作用。

-- 1) 第4章 slug 改名（保留原 id → 学员 task_progress / 整章积分不丢失）。
--    seed 按 slug upsert，若不改 slug 直接在 seed 中改名会导致旧行被删、进度级联清空。
UPDATE articles SET slug = 'ai-project' WHERE slug = 'ai-deploy';

-- 2) files.source 补列（init-db.js 已有幂等补列逻辑；此处兜底手动部署场景）
--    MySQL 不支持 ADD COLUMN IF NOT EXISTS，执行前先人工确认列不存在：
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND COLUMN_NAME = 'source';
-- 若查询结果为空，再执行：
-- ALTER TABLE files ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'upload'
--   COMMENT '来源：upload=手动上传 / gen=站内一句话生成' AFTER audit_reason;

-- 执行顺序：本文件 → 发新代码 → node seed-articles.js → 冒烟测试
