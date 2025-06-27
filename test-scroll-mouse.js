/**
 * 测试 robot.scrollMouse 功能
 * 用于验证滚轮操作是否正常工作
 */

const robot = require('robotjs');

// 设置延迟
robot.setMouseDelay(1);

console.log('=== RobotJS 滚轮测试 ===');
console.log('平台:', process.platform);
console.log('当前鼠标位置:', robot.getMousePos());

// 测试函数
function testScrollMouse() {
    console.log('\n--- 开始滚轮测试 ---');
    
    // 获取当前鼠标位置
    const currentPos = robot.getMousePos();
    console.log('测试前鼠标位置:', currentPos);
    
    // 测试1: 垂直向下滚动
    console.log('\n测试1: 垂直向下滚动 (deltaY = 3)');
    try {
        robot.scrollMouse(0, 3);
        console.log('✓ 垂直向下滚动执行成功');
    } catch (error) {
        console.error('✗ 垂直向下滚动失败:', error.message);
    }
    
    // 等待一下
    setTimeout(() => {
        // 测试2: 垂直向上滚动
        console.log('\n测试2: 垂直向上滚动 (deltaY = -3)');
        try {
            robot.scrollMouse(0, -3);
            console.log('✓ 垂直向上滚动执行成功');
        } catch (error) {
            console.error('✗ 垂直向上滚动失败:', error.message);
        }
        
        // 等待一下
        setTimeout(() => {
            // 测试3: 水平向右滚动
            console.log('\n测试3: 水平向右滚动 (deltaX = 3)');
            try {
                robot.scrollMouse(3, 0);
                console.log('✓ 水平向右滚动执行成功');
            } catch (error) {
                console.error('✗ 水平向右滚动失败:', error.message);
            }
            
            // 等待一下
            setTimeout(() => {
                // 测试4: 水平向左滚动
                console.log('\n测试4: 水平向左滚动 (deltaX = -3)');
                try {
                    robot.scrollMouse(-3, 0);
                    console.log('✓ 水平向左滚动执行成功');
                } catch (error) {
                    console.error('✗ 水平向左滚动失败:', error.message);
                }
                
                // 等待一下
                setTimeout(() => {
                    // 测试5: 对角线滚动
                    console.log('\n测试5: 对角线滚动 (deltaX = 2, deltaY = 2)');
                    try {
                        robot.scrollMouse(2, 2);
                        console.log('✓ 对角线滚动执行成功');
                    } catch (error) {
                        console.error('✗ 对角线滚动失败:', error.message);
                    }
                    
                    // 等待一下
                    setTimeout(() => {
                        // 测试6: 大数值滚动
                        console.log('\n测试6: 大数值滚动 (deltaX = 10, deltaY = 10)');
                        try {
                            robot.scrollMouse(10, 10);
                            console.log('✓ 大数值滚动执行成功');
                        } catch (error) {
                            console.error('✗ 大数值滚动失败:', error.message);
                        }
                        
                        // 等待一下
                        setTimeout(() => {
                            // 测试7: 小数值滚动
                            console.log('\n测试7: 小数值滚动 (deltaX = 1, deltaY = 1)');
                            try {
                                robot.scrollMouse(1, 1);
                                console.log('✓ 小数值滚动执行成功');
                            } catch (error) {
                                console.error('✗ 小数值滚动失败:', error.message);
                            }
                            
                            // 等待一下
                            setTimeout(() => {
                                // 测试8: 零值滚动
                                console.log('\n测试8: 零值滚动 (deltaX = 0, deltaY = 0)');
                                try {
                                    robot.scrollMouse(0, 0);
                                    console.log('✓ 零值滚动执行成功（应该无效果）');
                                } catch (error) {
                                    console.error('✗ 零值滚动失败:', error.message);
                                }
                                
                                // 最终检查
                                setTimeout(() => {
                                    const finalPos = robot.getMousePos();
                                    console.log('\n--- 测试完成 ---');
                                    console.log('测试后鼠标位置:', finalPos);
                                    console.log('鼠标位置变化:', {
                                        x: finalPos.x - currentPos.x,
                                        y: finalPos.y - currentPos.y
                                    });
                                    
                                    if (finalPos.x === currentPos.x && finalPos.y === currentPos.y) {
                                        console.log('✓ 鼠标位置未改变（滚轮操作不影响鼠标位置）');
                                    } else {
                                        console.log('⚠ 鼠标位置发生了变化（可能滚轮操作影响了鼠标位置）');
                                    }
                                    
                                    console.log('\n=== 测试总结 ===');
                                    console.log('如果所有测试都显示"执行成功"，说明 robot.scrollMouse 功能正常');
                                    console.log('请观察测试过程中是否有实际的滚轮效果（如页面滚动、窗口滚动等）');
                                }, 500);
                            }, 500);
                        }, 500);
                    }, 500);
                }, 500);
            }, 500);
        }, 500);
    }, 500);
}

// 运行测试
console.log('\n准备开始测试...');
console.log('请确保当前窗口可以接收滚轮事件（如浏览器、文本编辑器等）');
console.log('3秒后开始测试...');

setTimeout(() => {
    testScrollMouse();
}, 3000); 