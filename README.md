# 胖猫暂停一下（PurrPause） 🐱

一只胖猫在你盯屏幕太久时走出来挡住你的屏幕，提醒你暂停一下。

## 功能

- 监控屏幕使用时间，超时后肥猫从屏幕边缘走到中央
- 四种动画模式：右下角走出（放大）、中央淡入、右侧走出、中央走出（需激活）
- 猫咪从小变大，走完后躺下占满屏幕
- 倒计时休息，结束后猫咪渐变消失
- 多显示器支持，猫咪同时出现在所有屏幕
- 暂停监控（30 分钟 / 1 小时 / 2 小时 / 手动恢复）
- 延后休息（"再等 5 分钟"，每次最多 2 次）
- 托盘菜单显示距下次休息剩余时间
- 开机自动启动
- 支持自定义 webm 视频素材（激活用户可自定义目录）
- 机器码绑定的序列号激活系统（7 天免费试用）
- 系统托盘常驻，不占用任务栏
- 单实例运行，重复启动会立即退出，不会创建第二个托盘进程

## 安装

### Ubuntu / Debian

```bash
sudo dpkg -i dist/purr-pause_1.0.0_amd64.deb
```

### 从源码运行

```bash
git clone <repo-url>
cd purr-pause
npm install
npm start
```

## 使用

1. 安装后自动在系统托盘显示肥猫图标
2. 右键托盘图标可以：暂停监控、设置时间、计时规则、查看日志、立即测试、激活/续期、退出
3. 托盘菜单显示激活状态、距下次休息的剩余时间和软件版本号
4. 屏幕使用时间到达阈值后，猫咪自动出现在所有显示器上
5. 可点击"再等 5 分钟"延后休息（最多 2 次）
6. 点击"精力充沛！"按钮结束休息；倒计时结束后会自动关闭

## 设置

右键托盘图标 → 设置：

| 选项 | 说明 | 范围 |
|------|------|------|
| 屏幕使用时间 | 连续使用多久后提醒 | 1-480 分钟 |
| 休息时长 | 每次休息持续多久 | 1-60 分钟 |
| 动画模式 | 猫咪出现的方式（需激活） | 右下角走出 / 中央淡入 / 右侧走出 / 中央走出 |
| 素材目录 | 自定义视频素材路径（需激活） | — |
| 开机自动启动 | 系统启动时自动运行；Ubuntu 下写入 `~/.config/autostart/purr-pause.desktop` | 开/关 |

## 自定义素材

将 webm 视频放到 `~/.config/purr-pause/webm/` 目录下：

- `cat-walk.webm` — 走路动画（播放一次）
- `cat-rest.webm` — 躺下动画（循环播放）

`walk-zoom`、`walk-flat`、`walk-center` 使用两个视频；`fade-center` 只使用 `cat-rest.webm`。

要求：WebM 格式，VP9 编码，带 Alpha 通道（透明背景）。

## 序列号

### 激活流程

1. 用户在激活窗口中查看并复制自己的 **机器码**（16 位）
2. 将机器码发送给开发者
3. 开发者根据机器码生成绑定该机器的序列号
4. 用户输入序列号完成激活

序列号格式：以 `PP-` 为前缀，后接 Base64 编码数据，并按每 8 个字符用 `-` 分隔。

每个序列号绑定特定机器，不可在其他设备上使用。

### 生成序列号（开发者）

```bash
node tools/keygen.js --mid <机器码> --days 30        # 30 天
node tools/keygen.js --mid <机器码> --days 365       # 1 年
node tools/keygen.js --mid <机器码> --permanent      # 永久
node tools/keygen.js --verify <序列号>               # 验证
```

### 激活

右键托盘图标 → 激活/续期，复制机器码发给开发者，获取序列号后输入激活。

## 打包

```bash
npm run build:linux   # Ubuntu deb
npm run build:mac     # macOS dmg (需在 Mac 上)
npm run build:win     # Windows exe (需在 Windows 上)
```

详细打包说明见 [docs/build-guide.md](docs/build-guide.md)。

## 技术栈

- Electron 33
- 纯 HTML/CSS/JS（无框架）
- WebM 视频 + CSS 动画
- Ed25519 序列号签名

## 项目结构

```
purr-pause/
├── main.js              # Electron 主进程
├── preload.js           # IPC 桥接
├── lib/license.js       # 序列号验证 & 激活管理
├── tools/keygen.js      # 序列号生成器（CLI）
├── renderer/
│   ├── index.html       # 猫咪动画覆盖层
│   ├── settings.html    # 设置窗口
│   └── activation.html  # 激活窗口
├── assets/
│   ├── images/tray-icon.png
│   └── webm/
│       ├── cat-walk.webm
│       └── cat-rest.webm
├── config.json          # 默认配置
├── docs/                # 文档
└── .github/workflows/   # CI/CD
```

## 致谢

本应用主要通过 vibe coding 方式完成，即由开发者提出产品需求、交互细节与实现方向，并借助 AI 编程工具协助完成代码实现、调试与文档整理。

内置猫咪视频素材由 GitHub 用户 [louiscmli0719](https://github.com/louiscmli0719) 协助完成。感谢其在素材制作与整理上的贡献。

## License

MIT
