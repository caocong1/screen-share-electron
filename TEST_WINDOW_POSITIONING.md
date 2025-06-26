# 窗口位置检测测试指南

## 测试目的
验证在 macOS 扩展显示模式下，应用能够正确检测和显示窗口的实际位置和大小。

## 测试前准备

### 1. 系统要求
- macOS 系统
- 连接外接显示器并设置为扩展模式
- 确保应用有屏幕录制权限

### 2. 权限设置
如果您遇到权限问题，请：
1. 打开 "系统偏好设置" > "安全性与隐私" > "隐私"
2. 选择 "屏幕录制"
3. 添加并允许您的终端应用程序（如 Terminal 或 iTerm）

## 测试步骤

### 第一步：启动应用
```bash
cd /Users/dongli/Workspace/screen-share-electron
npm start
```

### 第二步：观察日志输出
应用启动后，查看控制台输出，应该能看到类似以下的信息：

```
[ALL-WINDOWS] 获取到 X 个窗口信息
[DESKTOP-SOURCES] 获取到的源数量: X
[DESKTOP-SOURCES] 可用显示器: [...]
```

### 第三步：选择主机模式
1. 点击 "主机模式" 按钮
2. 观察屏幕源列表的显示

### 第四步：检查窗口源显示
在屏幕源列表中，寻找标记为：
- 🎯 窗口 (实际位置) - 表示成功获取到实际窗口位置
- 📍 窗口 (估算位置) - 表示使用估算位置
- 🪟 窗口 - 表示普通窗口检测

### 第五步：查看控制台日志
查找以下类型的日志信息：

#### 窗口匹配成功的日志：
```
[WINDOW-MATCH] 精确匹配: 窗口名称 -> 应用名:窗口名
[DESKTOP-SOURCES] 窗口源 window:xxx:0 找到实际位置: {
  windowName: "...",
  actualBounds: { x: 非0值, y: 非0值, width: xxx, height: xxx },
  displayId: 显示器ID,
  displayBounds: {...}
}
```

#### 期望的改进结果：
- 窗口的 `actualBounds.x` 和 `actualBounds.y` 应该不再都是 0
- 应该能看到窗口在外接显示器上的实际坐标（可能是负数）
- 应该能看到窗口匹配的成功日志

## 验证标准

### ✅ 成功标准
1. **窗口位置不再都是 (0,0)**
   - 至少有一些窗口显示实际的 x,y 坐标
   - 外接显示器上的窗口应该显示负坐标值

2. **显示器匹配正确**
   - 窗口能正确匹配到所在的显示器
   - 显示 `displayId` 为 1（主显示器）或 5（外接显示器）

3. **窗口类型正确识别**
   - 看到 🎯 图标表示实际位置检测成功
   - 窗口名称匹配正确

### ❌ 问题指标
1. 所有窗口仍然显示 `bounds: { x: 0, y: 0, ... }`
2. 所有窗口都标记为 "估算位置"
3. 看到 `[WINDOW-MATCH] 未找到匹配` 的错误

## 调试技巧

### 查看详细日志
如果需要更详细的调试信息，可以：
1. 打开开发者工具 (Cmd+Shift+I)
2. 查看 Console 标签页
3. 选择一个窗口源并观察日志输出

### 手动验证窗口位置
您可以在终端中运行以下命令来验证 AppleScript 是否能获取窗口信息：

```bash
osascript -e '
tell application "System Events"
  set windowList to {}
  repeat with proc in application processes
    try
      if visible of proc is true then
        set procName to name of proc
        repeat with win in windows of proc
          try
            set windowName to name of win
            set windowPosition to position of win
            set windowSize to size of win
            log procName & ": " & windowName & " at " & (item 1 of windowPosition) & "," & (item 2 of windowPosition)
          end try
        end repeat
      end if
    end try
  end repeat
end tell
'
```

## 常见问题

### Q: 所有窗口仍显示 (0,0) 位置
**A:** 可能的原因：
1. 权限不足 - 检查屏幕录制权限
2. AppleScript 执行失败 - 查看控制台错误信息
3. 窗口名称匹配失败 - 检查 `[WINDOW-MATCH]` 日志

### Q: 某些窗口无法检测到位置
**A:** 这是正常的，因为：
1. 某些应用可能阻止窗口信息获取
2. 最小化的窗口无法获取位置
3. 系统窗口可能有访问限制

### Q: 外接显示器上的窗口显示错误坐标
**A:** 请检查：
1. 显示器设置是否为扩展模式（非镜像模式）
2. 显示器的实际分辨率和位置设置
3. 查看 `[DESKTOP-SOURCES] 可用显示器` 的日志确认显示器信息

## 预期结果

成功的测试应该显示：
- 主显示器 (id=1) 上的窗口：坐标在 (0,0) 到 (1728,1117) 范围内
- 外接显示器 (id=5) 上的窗口：坐标在 (-3840,-1043) 到 (0,1117) 范围内
- 窗口能正确匹配并显示 🎯 图标
- 控制台日志显示实际的窗口位置信息

如果看到这些结果，说明窗口位置检测功能已经正常工作！ 