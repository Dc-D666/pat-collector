-- PatPlayer 数据库结构（MySQL 5.7+ / utf8mb4）
-- 使用：mysql -u pat -p pat < server/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_name VARCHAR(16) NOT NULL COMMENT '班级，如 2501',
  real_name VARCHAR(32) NOT NULL COMMENT '真实姓名',
  qq_tiny_id VARCHAR(32) NULL COMMENT 'QQ 频道 tiny_id（绑定后可空）',
  qq_session_id VARCHAR(32) NULL COMMENT 'QQ 会话 id（自动识别轻应用用，可空）',
  show_real_name TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否授权展示真实姓名（0=只展示昵称）',
  nickname VARCHAR(32) NULL COMMENT '展示昵称（未授权时用）',
  points INT NOT NULL DEFAULT 0 COMMENT '积分（⭐）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name (class_name, real_name),
  UNIQUE KEY uq_qq (qq_tiny_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  stored_name VARCHAR(64) NOT NULL COMMENT '落盘文件名（uuid+ext）',
  original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  size BIGINT NOT NULL COMMENT '字节数',
  mime_type VARCHAR(128) NOT NULL,
  title VARCHAR(255) NULL COMMENT '作品标题',
  description VARCHAR(2000) NULL COMMENT '作品简介',
  gameplay VARCHAR(2000) NULL COMMENT '玩法',
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_file (user_id, original_name),
  KEY idx_user (user_id),
  KEY idx_uploaded (uploaded_at),
  CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS apps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  app_url VARCHAR(512) NOT NULL COMMENT 'AI 轻应用链接',
  title VARCHAR(255) NOT NULL DEFAULT '' COMMENT '应用名称',
  description VARCHAR(2000) NULL COMMENT '简介（选填）',
  gameplay VARCHAR(2000) NULL COMMENT '玩法（选填）',
  source_feed_id VARCHAR(128) NULL COMMENT '来源帖子 BID（可空）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  CONSTRAINT fk_apps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL COMMENT 'URL 标识',
  chapter INT NOT NULL DEFAULT 0 COMMENT '章节序号',
  title VARCHAR(128) NOT NULL COMMENT '文章标题',
  summary VARCHAR(300) NULL COMMENT '一句话简介',
  content MEDIUMTEXT NOT NULL COMMENT 'Markdown 正文',
  tasks JSON NULL COMMENT '章节任务（数组）',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS points_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount INT NOT NULL COMMENT '积分变动（正数）',
  reason VARCHAR(32) NOT NULL COMMENT 'first_login/read_article/task/app_submit/file_submit',
  ref_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '防重标识：article_id 或 作品id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_reason_ref (user_id, reason, ref_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_points_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  article_id INT NOT NULL,
  task_index INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_article_task (user_id, article_id, task_index),
  KEY idx_user_article (user_id, article_id),
  CONSTRAINT fk_tp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_article FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
