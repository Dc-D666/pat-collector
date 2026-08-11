# PatPlayer 开机自启安装脚本（以管理员身份运行）
# 用法：右键 → 以管理员身份运行 PowerShell，然后执行此脚本

$ErrorActionPreference = "Stop"

$taskName = "PatPlayer服务器"
$projectDir = "e:\PatPlayer"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $nodePath) {
    Write-Host "❌ 未找到 Node.js，请先安装 Node.js 18+" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PatPlayer 开机自启安装程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 删除旧任务（如果存在）
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "🗑️  删除旧任务..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# 2. 创建计划任务操作
$action = New-ScheduledTaskAction -Execute $nodePath `
    -Argument "server\index.js" `
    -WorkingDirectory $projectDir

# 3. 创建触发器（系统启动时）
$trigger = New-ScheduledTaskTrigger -AtStartup

# 4. 创建设置（失败后重启）
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

# 5. 注册任务（以 SYSTEM 账户运行）
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "PatPlayer 作品收集管理系统 - 开机自启" `
    -Force

Write-Host ""
Write-Host "✅ 安装成功！" -ForegroundColor Green
Write-Host ""
Write-Host "📋 管理命令：" -ForegroundColor Cyan
Write-Host "  启动服务:   Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  停止服务:   Stop-ScheduledTask -TaskName '$taskName'"
Write-Host "  查看状态:   Get-ScheduledTask -TaskName '$taskName' | Select State"
Write-Host "  卸载服务:   Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host ""
Write-Host "💡 提示：服务将在下次系统启动时自动运行" -ForegroundColor Yellow
Write-Host "   如需立即启动，请运行: Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""

# 询问是否立即启动
$startNow = Read-Host "是否立即启动服务？(y/n)"
if ($startNow -eq 'y') {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "✅ 服务已启动，访问 http://localhost:3000" -ForegroundColor Green
}
