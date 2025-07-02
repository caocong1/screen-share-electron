# 从 RobotJS 迁移到 Nut.js

## 迁移概述

本项目已成功从 RobotJS 迁移到 Nut.js，以提供更好的跨平台兼容性和更稳定的滚轮支持。

## 迁移原因

### RobotJS 的问题
1. **滚轮支持不稳定**: 在 Windows 环境下，`robot.scrollMouse()` 经常无法正常工作
2. **编译问题**: 需要针对不同 Node.js 版本重新编译
3. **维护状态**: 项目维护不够活跃
4. **跨平台兼容性**: 在某些平台上的行为不一致

### Nut.js 的优势
1. **更好的滚轮支持**: 提供专门的 `scrollUp()`, `scrollDown()`, `scrollLeft()`, `scrollRight()` 方法
2. **活跃维护**: 持续更新和改进
3. **更好的跨平台支持**: 在 Windows、macOS、Linux 上表现一致
4. **异步 API**: 使用 Promise 和 async/await，更现代
5. **更丰富的功能**: 提供更多鼠标和键盘控制选项

## 主要变更

### 1. 依赖变更
```json
// 移除
"robotjs": "^0.6.0"

// 添加
"@nut-tree/nut-js": "^4.2.0"
```

### 2. API 映射

#### 鼠标操作
| RobotJS | Nut.js |
|---------|--------|
| `robot.moveMouse(x, y)` | `await mouse.move([new Point(x, y)])` |
| `robot.mouseClick(button)` | `await mouse.pressButton(button)` + `await mouse.releaseButton(button)` |
| `robot.mouseToggle(direction, button)` | `await mouse.press(button)` / `await mouse.release(button)` |
| `robot.scrollMouse(x, y)` | `await mouse.scrollUp/Down/Left/Right(amount)` |

#### 键盘操作
| RobotJS | Nut.js |
|---------|--------|
| `robot.keyTap(key, modifiers)` | `await keyboard.pressKey(...modifiers, key)` |
| `robot.keyToggle(key, direction)` | `await keyboard.pressKey(key)` / `await keyboard.releaseKey(key)` |
| `robot.typeString(text)` | `await keyboard.type(text)` |

### 3. 代码变更示例

#### 鼠标移动
```javascript
// RobotJS
robot.moveMouse(100, 200);

// Nut.js
await mouse.move([new Point(100, 200)]);
```

#### 鼠标点击
```javascript
// RobotJS
robot.mouseClick("left");

// Nut.js
await mouse.pressButton(Button.Left);
await mouse.releaseButton(Button.Left);
```

#### 滚轮操作
```javascript
// RobotJS
robot.scrollMouse(0, 3);  // 垂直滚动

// Nut.js
await mouse.scrollDown(3);  // 向下滚动
await mouse.scrollUp(3);    // 向上滚动
```

#### 键盘操作
```javascript
// RobotJS
robot.keyTap("a", ["control"]);

// Nut.js
await keyboard.pressKey(Key.LeftControl, "a");
await keyboard.releaseKey("a", Key.LeftControl);
```

## 文件变更

### 主要文件
- `src/lib/nut-worker.cjs`: 完全重写为使用 Nut.js
- `package.json`: 更新依赖
- `docs/performance-optimizations.md`: 更新文档

### 测试文件
- 创建了 `test-nut-scroll.cjs` 用于测试 Nut.js 滚轮功能
- 移除了旧的 RobotJS 测试文件

## 性能优化

### 异步处理
Nut.js 的异步 API 允许更好的并发处理：
```javascript
// 批量处理鼠标移动
async function processPendingMouseMoves() {
    const coords = transformCoordinates(latestMove.data);
    await mouse.move([new Point(coords.x, coords.y)]);
}
```

### 配置优化
```javascript
// Nut.js 性能配置
mouse.config.mouseSpeed = 1000;     // 鼠标移动速度
keyboard.config.autoDelayMs = 5;    // 键盘延迟
```

## 兼容性

### 平台支持
- ✅ Windows 10/11
- ✅ macOS 10.15+
- ✅ Linux (Ubuntu 18.04+)

### Node.js 版本
- 要求: Node.js 16.0.0+
- 推荐: Node.js 18.0.0+

## 测试验证

### 滚轮测试
运行 `node test-nut-scroll.cjs` 验证滚轮功能：
```bash
✓ 垂直向下滚动成功
✓ 垂直向上滚动成功
✓ 水平向右滚动成功
✓ 水平向左滚动成功
```

### 导入测试
运行 `node test-nut-import.cjs` 验证模块导入：
```bash
✓ Nut.js 导入成功
可用组件: { mouse: 'object', keyboard: 'object', ... }
```

## 故障排除

### 常见问题

1. **模块导入失败**
   ```bash
   # 重新安装依赖
   pnpm install
   ```

2. **权限问题**
   ```bash
   # Windows: 以管理员身份运行
   # macOS: 授予辅助功能权限
   # Linux: 确保有 X11 访问权限
   ```

3. **滚轮不工作**
   - 确保鼠标悬停在可滚动区域
   - 检查目标应用是否支持滚轮事件
   - 尝试不同的滚动量

### 调试技巧
```javascript
// 启用详细日志
mouse.config.debug = true;
keyboard.config.debug = true;
```

## 总结

迁移到 Nut.js 带来了以下改进：

1. **更好的滚轮支持**: 解决了 Windows 下滚轮不工作的问题
2. **更稳定的跨平台表现**: 在所有平台上行为一致
3. **更现代的 API**: 使用 async/await，代码更清晰
4. **更好的维护性**: 活跃的社区和持续的更新
5. **更丰富的功能**: 提供更多控制选项

这次迁移显著提升了远程控制功能的可靠性和用户体验！🚀 