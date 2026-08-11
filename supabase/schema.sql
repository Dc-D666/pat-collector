-- PatPlayer Supabase 数据库 Schema
-- 在 Supabase SQL Editor 中执行此文件

-- 1. profiles 表：用户扩展信息
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  class_name VARCHAR(4) NOT NULL,
  name VARCHAR(50) NOT NULL,
  last4 VARCHAR(4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS：用户只能读写自己的 profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以读取自己班级的 profile"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR class_name = (SELECT class_name FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "用户只能更新自己的 profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "用户可以插入自己的 profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 2. file_meta 表：文件元数据
CREATE TABLE IF NOT EXISTS file_meta (
  id SERIAL PRIMARY KEY,
  blob_key TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  class_name VARCHAR(4) NOT NULL,
  student_name VARCHAR(50) NOT NULL,
  filename TEXT NOT NULL,
  size BIGINT DEFAULT 0,
  content_type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE file_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以读取自己班级的文件元数据"
  ON file_meta FOR SELECT
  USING (
    auth.uid() = user_id
    OR class_name = (SELECT class_name FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "用户可以插入自己的文件元数据"
  ON file_meta FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户可以删除自己的文件元数据"
  ON file_meta FOR DELETE
  USING (auth.uid() = user_id);

-- 3. 索引优化
CREATE INDEX IF NOT EXISTS idx_profiles_class ON profiles(class_name);
CREATE INDEX IF NOT EXISTS idx_file_meta_class_student ON file_meta(class_name, student_name);
CREATE INDEX IF NOT EXISTS idx_file_meta_blob_key ON file_meta(blob_key);
CREATE INDEX IF NOT EXISTS idx_file_meta_user_id ON file_meta(user_id);

-- 4. Storage Bucket 策略（在 Supabase Dashboard > Storage 中手动创建 'patplayer-files' bucket）
-- 然后将以下策略添加到该 bucket：
-- 
-- SELECT 策略：同班同学可读取
-- (class_name = (SELECT class_name FROM profiles WHERE id = auth.uid()))
-- 
-- INSERT 策略：用户可上传自己班级/姓名的文件
-- (auth.uid() IS NOT NULL)
-- 
-- DELETE 策略：用户只能删除自己的文件
-- (auth.uid() = owner)
