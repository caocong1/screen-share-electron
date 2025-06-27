/**
 * 快速测试 robot.scrollMouse 功能
 */

const robot = require('robotjs');

console.log('=== 快速滚轮测试 ===');
console.log('平台:', process.platform);

// 设置鼠标延迟
robot.setMouseDelay(1);

// 获取当前鼠标位置
const pos = robot.getMousePos();
console.log('当前鼠标位置:', pos);

// 测试滚轮功能
function quickTest() {
    console.log('\n开始测试...');
    
    // 测试垂直滚动
    console.log('测试垂直向下滚动...');
    try {
        robot.scrollMouse(0, 5);
        console.log('✓ 垂直滚动成功');
    } catch (error) {
        console.error('✗ 垂直滚动失败:', error.message);
    }
    
    // 等待1秒
    setTimeout(() => {
        console.log('测试垂直向上滚动...');
        try {
            robot.scrollMouse(0, -5);
            console.log('✓ 垂直向上滚动成功');
        } catch (error) {
            console.error('✗ 垂直向上滚动失败:', error.message);
        }
        
        // 等待1秒
        setTimeout(() => {
            console.log('测试水平滚动...');
            try {
                robot.scrollMouse(5, 0);
                console.log('✓ 水平滚动成功');
            } catch (error) {
                console.error('✗ 水平滚动失败:', error.message);
            }
            
            // 最终检查
            setTimeout(() => {
                const newPos = robot.getMousePos();
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
                console.log('如果看到页面或窗口滚动，说明功能正常。');
            }, 1000);
        }, 1000);
    }, 1000);
}

// 3秒后开始测试
console.log('\n3秒后开始测试，请确保鼠标在可滚动的窗口上...');
setTimeout(quickTest, 3000); 