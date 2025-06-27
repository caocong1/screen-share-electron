/**
 * 使用 nut.js 测试滚轮功能
 */

const { mouse, Point, sleep } = require('@nut-tree/nut-js');

console.log('=== Nut.js 滚轮测试 ===');
console.log('平台:', process.platform);

// 设置鼠标配置
mouse.config.mouseSpeed = 1000;

(async () => {
    try {
        // 获取当前鼠标位置
        const pos = await mouse.getPosition();
        console.log('当前鼠标位置:', pos);

        async function testScroll() {
            console.log('\n开始测试...');
            
            // 测试垂直滚动
            console.log('测试垂直向下滚动...');
            try {
                await mouse.scrollDown(50);
                console.log('✓ 垂直向下滚动成功');
            } catch (error) {
                console.error('✗ 垂直向下滚动失败:', error.message);
            }
            await sleep(1000);

            console.log('测试垂直向上滚动...');
            try {
                await mouse.scrollUp(50);
                console.log('✓ 垂直向上滚动成功');
            } catch (error) {
                console.error('✗ 垂直向上滚动失败:', error.message);
            }
            await sleep(1000);

            console.log('测试水平向右滚动...');
            try {
                await mouse.scrollRight(5);
                console.log('✓ 水平向右滚动成功');
            } catch (error) {
                console.error('✗ 水平向右滚动失败:', error.message);
            }
            await sleep(1000);

            console.log('测试水平向左滚动...');
            try {
                await mouse.scrollLeft(5);
                console.log('✓ 水平向左滚动成功');
            } catch (error) {
                console.error('✗ 水平向左滚动失败:', error.message);
            }
            await sleep(1000);

            // 最终检查
            const newPos = await mouse.getPosition();
            console.log('\n=== 测试结果 ===');
            console.log('测试后鼠标位置:', newPos);
            console.log('位置变化:', {
                x: newPos.x - pos.x,
                y: newPos.y - pos.y
            });

            if (newPos.x === pos.x && newPos.y === pos.y) {
                console.log('✓ 鼠标位置未改变（正常）');
            } else {
                console.log('⚠ 鼠标位置改变了');
            }

            console.log('\n请观察是否有实际的滚轮效果！');
            console.log('如果看到页面或窗口滚动，说明 nut.js 滚轮功能正常。');
        }

        console.log('\n3秒后开始测试，请确保鼠标在可滚动的窗口上...');
        await sleep(3000);
        await testScroll();
    } catch (error) {
        console.error('测试过程中发生错误:', error);
    }
})(); 