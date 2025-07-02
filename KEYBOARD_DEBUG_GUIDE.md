# 键盘录入调试指南

## 问题现象
键盘录入没有生效，远程控制时按键没有响应。

## 调试步骤

### 1. 运行调试脚本
```bash
cd screen-share-electron
node debug-keyboard.cjs
```

这个脚本会自动测试：
- nutjs库是否正确加载
- Nut Worker是否正常启动
- 键盘命令是否能正确处理

### 2. 检查控制台日志
启动应用后，打开开发者工具(F12)，在控制台中查看以下关键日志：

#### 前端日志 (渲染进程)
```
[全局键盘按下] - 检查键盘事件是否被捕获
[全局键盘] 准备发送keydown命令 - 检查命令是否准备发送
[全局键盘] keydown命令发送成功 - 检查命令是否发送成功
```

#### 后端日志 (主进程)
```
[远程控制] 键盘事件 - 检查主进程是否收到键盘事件
[远程控制] 发送命令到Worker - 检查是否发送到Worker
[远程控制] 键盘命令已发送到Worker - 确认发送成功
```

#### Worker日志
```
[Nut Worker] 收到keydown事件 - 检查Worker是否收到事件
[Nut Worker] 键位映射 - 检查键位映射是否正确
[Nut Worker] keydown执行成功 - 检查执行是否成功
```

### 3. 常见问题排查

#### 问题1: nutjs加载失败
**日志特征**: `❌ nutjs加载失败`
**解决方案**:
```bash
# 重新安装nutjs
npm uninstall @nut-tree/nut-js
npm install @nut-tree/nut-js

# 或者
pnpm remove @nut-tree/nut-js
pnpm add @nut-tree/nut-js
```

#### 问题2: 权限不足 (macOS)
**日志特征**: `权限不足` 或 `Accessibility permissions required`
**解决方案**:
1. 打开 `系统设置` > `隐私与安全性` > `辅助功能`
2. 添加你的终端应用和Electron应用
3. 重启应用

#### 问题3: Worker未就绪
**日志特征**: `Nut Worker 未就绪，跳过命令`
**解决方案**:
- 检查worker文件路径是否正确
- 查看Worker启动错误日志
- 重启应用

#### 问题4: 键盘事件未发送
**日志特征**: 没有看到`[全局键盘按下]`日志
**解决方案**:
- 确保启用了远程控制模式
- 检查焦点是否在正确的元素上
- 避免在输入框中测试

#### 问题5: 键位映射错误
**日志特征**: `[Nut Worker] keydown执行失败`
**解决方案**:
- 检查键位映射表是否包含该按键
- 查看错误详细信息
- 尝试使用简单按键测试(如字母a)

### 4. 测试建议

#### 基础测试
1. 先测试简单字母键: `a`, `b`, `c`
2. 测试特殊键: `Enter`, `Space`, `Backspace`
3. 测试修饰键组合: `Ctrl+C`, `Ctrl+V`

#### 高级测试
1. 测试功能键: `F1`, `F2`
2. 测试方向键: `ArrowUp`, `ArrowDown`
3. 测试文本输入: 使用虚拟键盘的文本输入功能

### 5. 强制调试模式

如果问题持续存在，可以临时修改代码启用详细日志：

```javascript
// 在 nut-worker.cjs 开头添加
console.log = (...args) => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`${timestamp} [Worker] ${args.join(' ')}\n`);
};
```

### 6. 平台特定问题

#### Windows
- 确保以管理员权限运行
- 检查Windows Defender是否阻止

#### macOS  
- 必须授予辅助功能权限
- 可能需要在安全设置中允许应用

#### Linux
- 确保X11或Wayland环境正常
- 检查用户是否有输入设备权限

### 7. 获取帮助

如果以上步骤都无法解决问题，请提供：
1. 调试脚本的完整输出
2. 应用控制台的完整日志
3. 操作系统版本和架构信息
4. nutjs版本信息

```bash
# 获取系统信息
node -p "process.platform + ' ' + process.arch"
npm list @nut-tree/nut-js
``` 