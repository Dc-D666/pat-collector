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
  guest_token VARCHAR(64) NULL COMMENT '访客直传项目地址令牌（长随机串，无过期）',
  guest_pwd_hash VARCHAR(200) NULL COMMENT '访客删除安全密码哈希（scrypt salt:hash；空=默认密码）',
  is_admin TINYINT(1) NOT NULL DEFAULT 0 COMMENT '管理员（仅 QQ 登录用户可为）',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active / disabled（停用：禁登录/上传）',
  github_uid VARCHAR(32) NULL COMMENT 'GitHub OAuth 用户 id（连接后非空）',
  github_login VARCHAR(64) NULL COMMENT 'GitHub OAuth 用户名（连接后非空）',
  github_token_enc VARCHAR(512) NULL COMMENT 'GitHub access_token（AES-256-GCM 加密存储，不落明文）',
  points INT NOT NULL DEFAULT 0 COMMENT '积分（⭐）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name (class_name, real_name),
  UNIQUE KEY uq_qq (qq_tiny_id),
  UNIQUE KEY uq_guest (guest_token)
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
  audit_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'HTML 审查状态：pending 待审 / reviewed 已过审 / flagged 违规（非 HTML 直接 reviewed）',
  audit_reason VARCHAR(500) NOT NULL DEFAULT '' COMMENT '审查不通过原因',
  source VARCHAR(16) NOT NULL DEFAULT 'upload' COMMENT '来源：upload=手动上传 / gen=站内一句话生成（2026-08-25）',
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

-- GitHub 项目外链（2026-08-20）：Token 文件验证防冒充（仓库根目录 nanfang-pat.txt 写入平台发放的 token），验证通过才计分
CREATE TABLE IF NOT EXISTS links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  url VARCHAR(512) NOT NULL COMMENT 'GitHub 仓库链接',
  title VARCHAR(255) NOT NULL DEFAULT '' COMMENT '项目名称',
  description VARCHAR(2000) NULL COMMENT '简介（选填）',
  owner VARCHAR(128) NOT NULL DEFAULT '' COMMENT '仓库 owner',
  repo VARCHAR(128) NOT NULL DEFAULT '' COMMENT '仓库名',
  verify_token VARCHAR(64) NOT NULL DEFAULT '' COMMENT '验证 token（写入仓库根目录 nanfang-pat.txt）',
  verified TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否通过所有权验证',
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  UNIQUE KEY uq_link_user_url (user_id, url),
  CONSTRAINT fk_links_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

-- 作品点赞：一人对同一作品只能赞一次；点赞人每日票数、作者每日积分收入上限在接口层控制
CREATE TABLE IF NOT EXISTS upload_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_created (user_id, created_at),
  CONSTRAINT fk_ulog_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 作品点赞：一人对同一作品只能赞一次；点赞人每日票数、作者每日积分收入上限在接口层控制
CREATE TABLE IF NOT EXISTS likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '点赞人',
  target_type VARCHAR(8) NOT NULL COMMENT 'file / app',
  target_id INT NOT NULL COMMENT '作品 id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_liker (user_id, target_type, target_id),
  KEY idx_target (target_type, target_id),
  KEY idx_created (created_at),
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 频道帖子点赞快照（被动获赞积分）：jobs 定时用 CLI 查 get-feed-detail 的 prefer_count，
-- 与上次快照对比取增量发分（帖子每获赞 1 个 +2⭐，作者每日上限 30）。
-- 追加式记录：每轮轮询插一行，delta = 本次 prefer_count - 上次快照值；无上次快照视为基线（delta=0）
CREATE TABLE IF NOT EXISTS feed_like_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feed_id VARCHAR(128) NOT NULL COMMENT '频道帖子 BID',
  like_count INT NOT NULL COMMENT '本次查到的 prefer_count',
  owner_user_id INT NOT NULL COMMENT '帖子作者（app 提交者）',
  delta INT NOT NULL DEFAULT 0 COMMENT '与上次快照的增量赞数',
  points_granted INT NOT NULL DEFAULT 0 COMMENT '本次实际发放积分',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_feed (feed_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 彩蛋积分：连续点击顶栏积分徽章 5 次触发（前端计数），
-- 由 points_log 唯一键 (user_id, reason='easter_egg', ref_id='once') 保证只发一次

-- 积分消费记录（积分商城兑换）：
-- item: wall_top(作品展置顶24h) / app_top(频道帖子置顶24h) / app_essence(频道精华24h) / title(专属称号30天)
-- ref_type/ref_id: 目标作品（file/app），title 类为空；频道类需 app 有 source_feed_id
CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  item VARCHAR(32) NOT NULL,
  cost INT NOT NULL COMMENT '消耗积分',
  ref_type VARCHAR(8) NOT NULL DEFAULT '' COMMENT 'file / app / 空',
  ref_id INT NOT NULL DEFAULT 0,
  feed_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '频道帖子 BID（频道类兑换用）',
  feed_extra VARCHAR(256) NOT NULL DEFAULT '' COMMENT 'JSON：{create_time, author_id}，取消置顶用',
  title VARCHAR(64) NOT NULL DEFAULT '' COMMENT '称号文本（title 类）',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active / expired',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL COMMENT '生效截止（置顶/精华/称号）',
  KEY idx_user (user_id),
  KEY idx_item_expires (item, expires_at),
  CONSTRAINT fk_purchases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 管理后台操作审计：管理员每次写操作记一行（谁/何时/对什么/做了什么/IP）
CREATE TABLE IF NOT EXISTS admin_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL COMMENT '操作管理员 user_id',
  action VARCHAR(64) NOT NULL COMMENT '如 user.points.adjust / file.delete',
  target_type VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'user / file / app / ...',
  target_id INT NOT NULL DEFAULT 0,
  detail VARCHAR(1000) NOT NULL DEFAULT '' COMMENT 'JSON 备注',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin (admin_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评委评审（P3，2026-08-16）：人工评委团为作品打分（10 分制整数，4 维度加权），
-- 自动折算计分（round(综合分×30)，满分 300；综合分 <6 不兑现）。每个项目一条（重新评审覆盖）。
CREATE TABLE IF NOT EXISTS judge_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ref_type VARCHAR(8) NOT NULL COMMENT 'file / app',
  ref_id INT NOT NULL,
  scores VARCHAR(200) NOT NULL DEFAULT '{}' COMMENT 'JSON：{creativity,content,completeness,values}',
  total DECIMAL(4,2) NOT NULL DEFAULT 0 COMMENT '加权综合分 0-10',
  points INT NOT NULL DEFAULT 0 COMMENT '本次兑现积分',
  judge_user_id INT NULL COMMENT '评审人（管理员）',
  owner_user_id INT NULL COMMENT '作品作者 user_id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_judge (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 内容审查记录（O3，2026-08-15）：AI 审查拒绝的展示文本（作品标题/简介/玩法）落库可追溯
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(32) NOT NULL DEFAULT 'display_text' COMMENT '审查类型',
  content VARCHAR(500) NOT NULL DEFAULT '' COMMENT '被拒内容摘要',
  result VARCHAR(16) NOT NULL DEFAULT 'rejected' COMMENT 'rejected / approved',
  reason VARCHAR(200) NOT NULL DEFAULT '' COMMENT '拒绝原因',
  user_id INT NULL COMMENT '提交者（可空）',
  ref_type VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'file / app',
  ref_id INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 运行时设置（管理后台：商城开关 shop_enabled 等，不重启生效）
CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(64) PRIMARY KEY,
  svalue VARCHAR(500) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 一句话生成小程序：创作槽与版本链（2026-08-25）
-- 每用户 5 个固定槽位，每槽一条版本链；未提交的历史版本不占作品配额，7 天未动自动清理
CREATE TABLE IF NOT EXISTS gen_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  slot_no TINYINT NOT NULL COMMENT '槽位号 1-5',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_slot (user_id, slot_no),
  CONSTRAINT fk_genslot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gen_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slot_id INT NOT NULL,
  seq INT NOT NULL COMMENT '槽内版本序号，从 1 递增',
  idea VARCHAR(2000) NOT NULL DEFAULT '' COMMENT '生成该版时的需求描述（对话记录）',
  stored_path VARCHAR(255) NOT NULL COMMENT '相对 storage/gen 的路径',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slot_seq (slot_id, seq),
  CONSTRAINT fk_genver_slot FOREIGN KEY (slot_id) REFERENCES gen_slots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
