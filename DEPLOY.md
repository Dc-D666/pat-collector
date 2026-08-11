# PatPlayer 部署指南

## 一、环境要求
- Node.js 18+ 
- Windows 10/11 或 Windows Server

## 二、首次安装

```powershell
# 1. 进入项目目录
cd e:\PatPlayer

# 2. 安装依赖
npm install

# 3. 构建前端
npm run build

# 4. 启动服务（测试）
npm start
```

打开浏览器访问 http://localhost:3000

## 三、开机自启（Windows）

### 方法一：使用 Windows 计划任务（推荐）

```powershell
# 以管理员身份运行 PowerShell，执行：
powershell -ExecutionPolicy Bypass -File "e:\PatPlayer\scripts\install-service.ps1"
```

### 方法二：手动创建计划任务

1. 打开「任务计划程序」(taskschd.msc)
2. 创建任务 → 触发器：**在系统启动时**
3. 操作 → 启动程序：
   - 程序：`node`
   - 参数：`e:\PatPlayer\server\index.js`
   - 起始于：`e:\PatPlayer`
4. 条件：取消「仅当使用交流电源时」
5. 设置：勾选「如果任务失败，每隔1分钟重启一次」最多3次

## 四、每日备份

```powershell
# 手动备份
npm run backup

# 设置定时备份（每天 18:00）
schtasks /create /tn "PatPlayer每日备份" /tr "node e:\PatPlayer\server\backup.js" /sc daily /st 18:00 /ru SYSTEM
```

备份文件存储在 `e:\PatPlayer\backups\`，保留最近30天。

## 五、管理命令

```powershell
# 查看服务是否运行
netstat -ano | findstr :3000

# 停止服务
taskkill /F /IM node.exe
# 或通过任务管理器结束 node.exe 进程

# 重启服务
npm start
```

## 六、目录结构

```
e:\PatPlayer\
├── server/          # 后端 Express 服务
├── src/             # Astro 前端源码
├── dist/            # 构建后的前端（需要 npm run build）
├── uploads/         # 文件存储（按 班级/姓名 组织）
│   ├── 2501/
│   │   ├── 张三/
│   │   └── 李四/
│   └── ...
├── backups/         # 每日备份（保留30天）
└── logs/            # 日志（可选）
```

## 七、安全注意事项

- 仅在内网部署，不要暴露到公网
- 定期检查 `uploads/` 目录磁盘空间
- 备份文件定期拷贝到其他存储设备
