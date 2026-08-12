-- PatPlayer 数据库结构（MySQL 5.7+ / utf8mb4）
-- 使用：mysql -u pat -p pat < server/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_name VARCHAR(16) NOT NULL COMMENT '班级，如 2501',
  real_name VARCHAR(32) NOT NULL COMMENT '真实姓名',
  qq_tiny_id VARCHAR(32) NULL COMMENT 'QQ 频道 tiny_id（绑定后可空）',
  qq_session_id VARCHAR(32) NULL COMMENT 'QQ 会话 id（自动识别轻应用用，可空）',
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
