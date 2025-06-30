#!/usr/bin/env node

/**
 * 键盘调试测试脚本
 * 运行这个脚本来测试nutjs键盘功能是否正常
 */

const { Worker } = require('worker_threads');
const path = require('path');

console.log('🔍 开始键盘功能调试...\n');

// 测试1: 检查nutjs是否能正常加载
console.log('📦 测试1: 检查nutjs库...');
try {
  const nut = require('@nut-tree/nut-js');
  console.log('✅ nutjs加载成功');

  // 检查键盘对象
  const keyboard = nut.keyboard.providerRegistry.getKeyboard();
  if (keyboard && typeof keyboard.pressKey === 'function') {
    console.log('✅ 键盘API可用');
  } else {
    console.log('❌ 键盘API不可用');
  }

  console.log('📋 nutjs版本信息:', {
    version: nut.version || '未知',
    platform: process.platform,
    arch: process.arch,
  });
} catch (error) {
  console.error('❌ nutjs加载失败:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');

// 测试2: 测试Robot Worker
console.log('🤖 测试2: 检查Robot Worker...');
const workerPath = path.join(__dirname, 'src', 'lib', 'robot-worker.cjs');
console.log('Worker路径:', workerPath);

const worker = new Worker(workerPath);
let workerReady = false;

worker.on('message', (message) => {
  console.log('📨 Worker消息:', message);

  if (message.type === 'ready') {
    workerReady = true;
    console.log('✅ Robot Worker已就绪');

    // 测试键盘命令
    setTimeout(() => {
      console.log('\n🧪 测试3: 发送键盘测试命令...');

      const testCommands = [
        {
          type: 'keytype',
          text: 'Hello Test!',
          source: 'debug',
        },
        {
          type: 'keydown',
          key: 'a',
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          source: 'debug',
        },
        {
          type: 'keyup',
          key: 'a',
          source: 'debug',
        },
        {
          type: 'shortcut',
          key: 'c',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          source: 'debug',
        },
      ];

      testCommands.forEach((command, index) => {
        setTimeout(() => {
          console.log(
            `📤 发送测试命令 ${index + 1}:`,
            command.type,
            command.key || command.text,
          );
          worker.postMessage({
            type: 'command',
            data: command,
          });
        }, index * 1000);
      });

      // 5秒后关闭worker
      setTimeout(() => {
        console.log('\n🏁 测试完成，关闭Worker...');
        worker.terminate();
        process.exit(0);
      }, 6000);
    }, 1000);
  }

  if (message.type === 'error') {
    console.error('❌ Worker错误:', message.message);
  }

  if (message.type === 'processed') {
    console.log('✅ 命令处理完成:', message.originalType);
  }
});

worker.on('error', (error) => {
  console.error('❌ Worker启动错误:', error);
});

worker.on('exit', (code) => {
  console.log('🚪 Worker退出，代码:', code);
});

// 10秒超时
setTimeout(() => {
  if (!workerReady) {
    console.log('⏰ Worker启动超时');
    worker.terminate();
    process.exit(1);
  }
}, 10000);

console.log('⏳ 等待Worker启动...');
