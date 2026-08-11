// 每日备份脚本
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function backup() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const backupDir = path.join(ROOT, 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const uploadsDir = path.join(ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('⚠️ uploads 目录不存在，跳过备份');
    return;
  }

  const backupName = `backup-${dateStr}.zip`;
  const backupPath = path.join(backupDir, backupName);

  // 使用 PowerShell 压缩（Windows 内置，无需额外依赖）
  const psScript = `
    $source = '${uploadsDir.replace(/\\/g, '\\\\')}'
    $dest = '${backupPath.replace(/\\/g, '\\\\')}'
    Compress-Archive -Path "$source\\*" -DestinationPath $dest -Force
  `;

  try {
    execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'pipe' });
    console.log(`✅ 备份成功: ${backupName}`);

    // 只保留最近30天的备份
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.zip'))
      .sort();

    while (backups.length > 30) {
      const old = backups.shift();
      fs.unlinkSync(path.join(backupDir, old));
      console.log(`🗑️ 清理旧备份: ${old}`);
    }
  } catch (err) {
    console.error('❌ 备份失败:', err.message);
  }
}

backup();
