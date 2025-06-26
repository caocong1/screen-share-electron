# 窗口位置检测改进

## 问题描述
在 macOS 连接外接显示器使用扩展模式时，窗口的实际大小和相对位置没有正确获取，导致远程控制时坐标不准确。

## 解决方案

### 1. 后端改进 (src/index.cjs)

#### 改进的 `get-desktop-sources` 处理器
- 增强了窗口源和屏幕源的识别逻辑
- 优先使用 `display_id` 来匹配对应的显示器
- 为窗口源添加了窗口信息字段（`windowInfo`）
- 增加了调试信息输出

```javascript
// 新增的窗口信息字段
windowInfo = {
  type: 'window',
  appName: source.name,
  thumbnailSize: { width, height },
  estimated: true // 标记是否为估算值
};
```

#### 新增的 `get-window-details` 处理器
- 在 macOS 上使用 `osascript` 获取前台窗口的精确位置和大小
- 自动匹配窗口所在的显示器
- 计算窗口在显示器内的相对位置

```javascript
// 返回的窗口详细信息
{
  appName: '应用名称',
  windowBounds: { x, y, width, height }, // 窗口的绝对位置
  displayInfo: { bounds, scaleFactor }, // 所在显示器信息
  relativePosition: { x, y } // 窗口在显示器内的相对位置
}
```

### 2. 前端改进 (src/renderer/app.js)

#### 增强的窗口检测 (`isWindowShare`)
- 添加了 7 种不同的窗口检测方法
- 优先检查明确的窗口标记（`isActualWindow`、`windowBounds`）
- 智能处理多显示器环境下的全屏应用

#### 改进的坐标转换 (`calculateVideoCoordinates`)
- 优先使用实际窗口边界信息（`windowBounds`）
- 支持回退到屏幕边界信息
- 增加了详细的调试信息输出

#### 自动获取窗口详细信息
- 选择窗口源时自动调用 `getWindowDetails` API
- 更新屏幕信息以包含实际窗口位置
- 处理 API 调用失败的情况

### 3. API 改进 (src/preload.cjs)

#### 新增 API
```javascript
// 获取窗口详细信息
getWindowDetails: (sourceId) => ipcRenderer.invoke('get-window-details', sourceId)
```

## 使用说明

### 测试步骤
1. 启动应用：`npm start`
2. 选择"主机模式"
3. 在屏幕源列表中选择一个窗口源
4. 查看控制台输出的调试信息
5. 开始屏幕共享并测试远程控制

### 调试信息
- `[DESKTOP-SOURCES]`：桌面源获取过程
- `[WINDOW-DETAILS]`：窗口详细信息获取
- `[SOURCE-SELECT]`：源选择过程
- `[坐标转换]`：坐标转换过程

### 预期效果
- 窗口源会正确显示其所在的显示器信息
- 窗口的实际位置和大小会被准确检测
- 远程控制时鼠标坐标会正确映射到目标窗口

## 技术细节

### macOS 特殊处理
- 使用 AppleScript 获取前台窗口信息
- 支持多显示器环境下的坐标转换
- 处理 Retina 显示器的缩放因子

### 多显示器支持
- 自动检测窗口所在的显示器
- 支持扩展和镜像显示模式
- 正确处理显示器之间的坐标偏移

### 错误处理
- 权限不足时的优雅降级
- API 调用失败时的回退机制
- 详细的错误日志记录

## 兼容性
- macOS：完整支持，包括窗口位置检测
- Windows：基础支持，使用显示器信息
- Linux：基础支持，使用显示器信息

## 已知限制
- macOS 上获取其他应用窗口位置可能需要辅助功能权限
- 某些应用可能阻止窗口信息获取
- 最小化或隐藏的窗口无法获取位置信息 