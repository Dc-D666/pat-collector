# PatPlayer 每日备份任务安装脚本（以管理员身份运行）

$ErrorActionPreference = "Stop"

$taskName = "PatPlayer每日备份"
$projectDir = "e:\PatPlayer"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $nodePath) {
    Write-Host "❌ 未找到 Node.js" -ForegroundColor Red
    exit 1
}

# 删除旧任务
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "🗑️  删除旧备份任务"
}

# 创建任务
$action = New-ScheduledTaskAction -Execute $nodePath `
    -Argument "server\backup.js" `
    -WorkingDirectory $projectDir

# 每天 18:00 执行
$trigger = New-ScheduledTaskTrigger -Daily -At "18:00"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount

Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "PatPlayer 每日备份 uploads 目录" `
    -Force

Write-Host "✅ 每日备份任务已设置（每天 18:00 执行）" -ForegroundColor Green
Write-Host "   备份目录: $projectDir\backups\"
Write-Host "   手动备份: npm run backup"
