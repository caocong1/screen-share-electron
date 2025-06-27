/**
 * robotjs Worker 线程 - 处理远程控制操作
 * 避免在主线程中执行robotjs操作，提高响应性能
 */

const {
	Worker,
	isMainThread,
	parentPort,
	workerData,
} = require("worker_threads");

if (isMainThread) {
	throw new Error("此文件应该作为worker线程运行");
}

let robot;
try {
	robot = require("robotjs");
	// 优化robot性能设置
	robot.setMouseDelay(1); // 降低鼠标延迟
	robot.setKeyboardDelay(5); // 降低键盘延迟
} catch (error) {
	console.error("[Robot Worker] RobotJS 不可用:", error.message);
	parentPort.postMessage({
		type: "error",
		message: `RobotJS 初始化失败: ${error.message}`,
	});
	process.exit(1);
}

// 鼠标移动防抖优化
const mouseMoveBuffer = {
	queue: [],
	timer: null,
	maxBatchSize: 5,
	batchDelay: 4, // 4ms批处理延迟
	lastProcessTime: 0,
};

/**
 * 处理鼠标移动的批量优化
 */
function processPendingMouseMoves() {
	if (mouseMoveBuffer.queue.length === 0) return;

	// 只处理最新的坐标，丢弃中间的坐标
	const latestMove = mouseMoveBuffer.queue[mouseMoveBuffer.queue.length - 1];
	mouseMoveBuffer.queue = [];

	// 执行实际的鼠标移动
	try {
		const coords = transformCoordinates(latestMove.data);
		robot.moveMouse(coords.x, coords.y);
		mouseMoveBuffer.lastProcessTime = Date.now();

		// 发送处理完成确认
		parentPort.postMessage({
			type: "processed",
			originalType: latestMove.data.type,
			coords: coords,
			timestamp: Date.now(),
		});
	} catch (error) {
		console.error("[Robot Worker] 鼠标移动失败:", error);
	}
}

/**
 * 添加鼠标移动到队列
 */
function addMouseMoveToQueue(data) {
	mouseMoveBuffer.queue.push({ data, timestamp: Date.now() });

	// 如果队列太长，只保留最新的几个
	if (mouseMoveBuffer.queue.length > mouseMoveBuffer.maxBatchSize) {
		mouseMoveBuffer.queue = mouseMoveBuffer.queue.slice(
			-mouseMoveBuffer.maxBatchSize,
		);
	}

	// 设置或重置处理定时器
	if (mouseMoveBuffer.timer) {
		clearTimeout(mouseMoveBuffer.timer);
	}

	mouseMoveBuffer.timer = setTimeout(() => {
		processPendingMouseMoves();
		mouseMoveBuffer.timer = null;
	}, mouseMoveBuffer.batchDelay);
}

/**
 * 坐标转换函数（从主线程复制）
 */
function transformCoordinates(data) {
	let actualX = data.x;
	let actualY = data.y;

	// 如果有视频分辨率信息，进行精确的坐标映射
	if (data.videoResolution && data.screenInfo && data.screenInfo.bounds) {
		const bounds = data.screenInfo.bounds;
		const scaleFactor = data.screenInfo.scaleFactor || 1;
		const clientPlatform = data.clientPlatform || "unknown";
		const videoWidth = data.videoResolution.width;
		const videoHeight = data.videoResolution.height;

		// 核心坐标转换逻辑
		if (process.platform === "darwin" && scaleFactor > 1) {
			// macOS接收端，需要考虑Retina缩放
			if (clientPlatform === "win32") {
				// Windows -> macOS: 需要考虑视频分辨率和实际屏幕分辨率的映射
				const scaleX = bounds.width / videoWidth;
				const scaleY = bounds.height / videoHeight;
				actualX = bounds.x + data.x * scaleX;
				actualY = bounds.y + data.y * scaleY;
			} else {
				// macOS -> macOS: 直接映射
				actualX = bounds.x + data.x;
				actualY = bounds.y + data.y;
			}
		} else {
			// Windows/Linux接收端
			if (clientPlatform === "darwin") {
				// macOS -> Windows: 使用相对位置映射到物理分辨率
				const relativeX = data.x / videoWidth;
				const relativeY = data.y / videoHeight;
				actualX = bounds.x + relativeX * bounds.width * scaleFactor;
				actualY = bounds.y + relativeY * bounds.height * scaleFactor;
			} else {
				// Windows -> Windows: 直接映射
				actualX = bounds.x + data.x;
				actualY = bounds.y + data.y;
			}
		}
	} else if (data.screenInfo && data.screenInfo.bounds) {
		// 兜底逻辑：如果没有视频分辨率信息，使用原有逻辑
		const bounds = data.screenInfo.bounds;
		actualX = bounds.x + data.x;
		actualY = bounds.y + data.y;
	}

	return { x: Math.round(actualX), y: Math.round(actualY) };
}

/**
 * 主要的消息处理器
 */
parentPort.on("message", (message) => {
	try {
		const { type, data } = message;

		// 处理远程控制命令
		switch (data.type) {
			case "mousemove":
			case "mousedrag":
				// 使用批量处理优化鼠标移动
				addMouseMoveToQueue(data);
				break;

			case "mousedown": {
				// 鼠标按下需要立即处理
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				// 映射按键值：0=left, 1=middle, 2=right
				const downButton =
					typeof data.button === "number"
						? data.button === 0
							? "left"
							: data.button === 1
								? "middle"
								: "right"
						: data.button || "left";
				robot.mouseToggle("down", downButton);
				console.log("[Robot Worker] 鼠标按下:", {
					button: data.button,
					mapped: downButton,
				});
				break;
			}

			case "mouseup": {
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				// 映射按键值：0=left, 1=middle, 2=right
				const upButton =
					typeof data.button === "number"
						? data.button === 0
							? "left"
							: data.button === 1
								? "middle"
								: "right"
						: data.button || "left";
				robot.mouseToggle("up", upButton);
				console.log("[Robot Worker] 鼠标释放:", {
					button: data.button,
					mapped: upButton,
				});
				break;
			}

			case "mouseclick": {
				// 检查是否在拖拽状态中，如果是拖拽操作，则忽略后续的click事件
				// 避免拖拽选中被意外取消
				if (data.isDragging === false || data.source === "standalone-click") {
					// 只有在非拖拽状态下，或者明确标记为独立点击时才处理click事件
					if (data.x !== undefined && data.y !== undefined) {
						const coords = transformCoordinates(data);
						robot.moveMouse(coords.x, coords.y);
					}
					// 映射按键值：0=left, 1=middle, 2=right
					const clickButton =
						typeof data.button === "number"
							? data.button === 0
								? "left"
								: data.button === 1
									? "middle"
									: "right"
							: data.button || "left";
					robot.mouseClick(clickButton, false);
					console.log("[Robot Worker] 鼠标点击:", {
						button: data.button,
						mapped: clickButton,
					});
				} else {
					// 拖拽后的click事件被忽略
					console.log("[Robot Worker] 忽略拖拽后的click事件，防止取消选中");
				}
				break;
			}

			case "doubleclick": {
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				// 映射按键值：0=left, 1=middle, 2=right
				const dblClickButton =
					typeof data.button === "number"
						? data.button === 0
							? "left"
							: data.button === 1
								? "middle"
								: "right"
						: data.button || "left";
				robot.mouseClick(dblClickButton, true);
				console.log("[Robot Worker] 双击:", {
					button: data.button,
					mapped: dblClickButton,
				});
				break;
			}

			case "contextmenu":
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				robot.mouseClick("right");
				break;

			case "longpress": {
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				// 映射按键值：0=left, 1=middle, 2=right
				const longPressButton =
					typeof data.button === "number"
						? data.button === 0
							? "left"
							: data.button === 1
								? "middle"
								: "right"
						: data.button || "left";
				robot.mouseToggle("down", longPressButton);
				console.log("[Robot Worker] 长按开始:", {
					button: data.button,
					mapped: longPressButton,
				});
				setTimeout(() => {
					robot.mouseToggle("up", longPressButton);
					console.log("[Robot Worker] 长按结束:", { mapped: longPressButton });
				}, 100);
				break;
			}

			case "scroll":
				// 修复滚轮事件处理
				if (
					typeof data.deltaX === "number" ||
					typeof data.deltaY === "number"
				) {
					// 优先使用原始的 deltaX/deltaY 值
					let scrollX = 0;
					let scrollY = 0;

					// 处理 deltaY（垂直滚动）
					if (typeof data.deltaY === "number" && data.deltaY !== 0) {
						// 根据 deltaMode 调整滚动量
						if (data.deltaMode === 0) {
							// DOM_DELTA_PIXEL - 像素模式
							scrollY = Math.round(data.deltaY / 10); // 减小滚动量
						} else if (data.deltaMode === 1) {
							// DOM_DELTA_LINE - 行模式
							scrollY = Math.round(data.deltaY);
						} else if (data.deltaMode === 2) {
							// DOM_DELTA_PAGE - 页面模式
							scrollY = Math.round(data.deltaY * 10);
						} else {
							scrollY = Math.round(data.deltaY / 10);
						}
					}

					// 处理 deltaX（水平滚动）
					if (typeof data.deltaX === "number" && data.deltaX !== 0) {
						if (data.deltaMode === 0) {
							scrollX = Math.round(data.deltaX / 10);
						} else if (data.deltaMode === 1) {
							scrollX = Math.round(data.deltaX);
						} else if (data.deltaMode === 2) {
							scrollX = Math.round(data.deltaX * 10);
						} else {
							scrollX = Math.round(data.deltaX / 10);
						}
					}

					// 执行滚动
					if (scrollX !== 0 || scrollY !== 0) {
						robot.scrollMouse(scrollX, scrollY);
						console.log("[Robot Worker] 滚轮操作成功:", {
							原始: {
								deltaX: data.deltaX,
								deltaY: data.deltaY,
								deltaMode: data.deltaMode,
							},
							处理后: { scrollX, scrollY },
							执行结果: "已调用robot.scrollMouse",
						});
					} else {
						console.log("[Robot Worker] 滚轮操作跳过:", {
							原始: {
								deltaX: data.deltaX,
								deltaY: data.deltaY,
								deltaMode: data.deltaMode,
							},
							原因: "scrollX和scrollY都为0",
						});
					}
				} else if (typeof data.x === "number" || typeof data.y === "number") {
					// 兜底逻辑：使用处理过的 x/y 值
					const fallbackX = Math.round(data.x || 0);
					const fallbackY = Math.round(data.y || 0);
					robot.scrollMouse(fallbackX, fallbackY);
					console.log("[Robot Worker] 滚轮兜底处理:", {
						使用兜底逻辑: true,
						原始x: data.x,
						原始y: data.y,
						处理后: { fallbackX, fallbackY },
						执行结果: "已调用robot.scrollMouse",
					});
				} else {
					console.log("[Robot Worker] 滚轮事件无数据:", {
						data: data,
						错误: "没有可用的滚轮数据",
					});
				}
				break;

			case "gesturestart":
			case "gesturechange":
			case "gestureend":
				// 触摸板手势事件 - 可以转换为相应的系统手势或快捷键
				// 例如，双指缩放可以转换为Ctrl+滚轮
				if (data.scale && data.scale !== 1) {
					const scaleDirection = data.scale > 1 ? -1 : 1; // 放大时向上滚动，缩小时向下滚动
					const scrollAmount = Math.abs(data.scale - 1) * 5; // 根据缩放比例调整滚动量

					// 模拟Ctrl+滚轮进行缩放
					robot.keyToggle("control", "down");
					robot.scrollMouse(0, Math.round(scaleDirection * scrollAmount));
					robot.keyToggle("control", "up");
				}
				break;

			case "touchstart":
				// 触摸开始 - 模拟鼠标按下
				if (data.x !== undefined && data.y !== undefined) {
					const coords = transformCoordinates(data);
					robot.moveMouse(coords.x, coords.y);
				}
				// 单点触摸模拟左键，多点触摸可以有不同处理
				if (data.touchCount === 1) {
					robot.mouseToggle("down", "left");
				} else if (data.touchCount === 2) {
					// 双指触摸可以模拟右键
					robot.mouseToggle("down", "right");
				}
				break;

			case "touchmove":
				// 触摸移动 - 模拟鼠标拖拽
				if (data.touchCount === 1) {
					// 单点触摸作为鼠标移动
					addMouseMoveToQueue(data);
				}
				// 多点触摸可以处理为手势
				break;

			case "touchend":
				// 触摸结束 - 模拟鼠标释放
				if (data.touchCount <= 1) {
					robot.mouseToggle("up", "left");
				} else if (data.touchCount === 2) {
					robot.mouseToggle("up", "right");
				}
				break;

			case "keydown":
				if (data.key) {
					const modifiers = [];
					if (data.ctrlKey) modifiers.push("control");
					if (data.altKey) modifiers.push("alt");
					if (data.shiftKey) modifiers.push("shift");
					if (data.metaKey)
						modifiers.push(process.platform === "darwin" ? "command" : "meta");

					const keyMap = {
						ArrowUp: "up",
						ArrowDown: "down",
						ArrowLeft: "left",
						ArrowRight: "right",
						Delete: "delete",
						Backspace: "backspace",
						Enter: "enter",
						Tab: "tab",
						Escape: "escape",
						Space: "space",
						CapsLock: "capslock",
						Control: "control",
						Alt: "alt",
						Shift: "shift",
						Meta: process.platform === "darwin" ? "command" : "meta",
					};

					const robotKey = keyMap[data.key] || data.key.toLowerCase();

					if (modifiers.length > 0) {
						robot.keyTap(robotKey, modifiers);
					} else {
						robot.keyToggle(robotKey, "down");
					}
				}
				break;

			case "keyup":
				if (data.key) {
					const keyMap = {
						ArrowUp: "up",
						ArrowDown: "down",
						ArrowLeft: "left",
						ArrowRight: "right",
						Delete: "delete",
						Backspace: "backspace",
						Enter: "enter",
						Tab: "tab",
						Escape: "escape",
						Space: "space",
						CapsLock: "capslock",
						Control: "control",
						Alt: "alt",
						Shift: "shift",
						Meta: process.platform === "darwin" ? "command" : "meta",
					};

					const robotKey = keyMap[data.key] || data.key.toLowerCase();
					robot.keyToggle(robotKey, "up");
				}
				break;

			case "keypress":
				if (data.key) {
					robot.keyTap(data.key, data.modifiers || []);
				}
				break;

			case "keytype":
				if (data.text) {
					robot.typeString(data.text);
				}
				break;

			case "shortcut":
				if (data.key) {
					const modifiers = [];
					if (data.ctrlKey) modifiers.push("control");
					if (data.altKey) modifiers.push("alt");
					if (data.shiftKey) modifiers.push("shift");
					if (data.metaKey)
						modifiers.push(process.platform === "darwin" ? "command" : "meta");

					const keyMap = {
						c: "c",
						v: "v",
						x: "x",
						z: "z",
						y: "y",
						a: "a",
						s: "s",
						tab: "tab",
						esc: "escape",
						l: "l",
						d: "d",
						r: "r",
						space: "space",
					};

					const robotKey =
						keyMap[data.key.toLowerCase()] || data.key.toLowerCase();
					robot.keyTap(robotKey, modifiers);
				}
				break;

			case "functionkey":
				if (data.key) {
					const fKeyMap = {
						F1: "f1",
						F2: "f2",
						F3: "f3",
						F4: "f4",
						F5: "f5",
						F6: "f6",
						F7: "f7",
						F8: "f8",
						F9: "f9",
						F10: "f10",
						F11: "f11",
						F12: "f12",
					};

					const robotKey = fKeyMap[data.key] || data.key.toLowerCase();
					robot.keyTap(robotKey);
				}
				break;

			default:
				console.warn("[Robot Worker] 未知命令类型:", data.type);
		}

		// 发送处理完成确认（除了鼠标移动，那个会在批处理中发送）
		if (data.type !== "mousemove" && data.type !== "mousedrag") {
			parentPort.postMessage({
				type: "processed",
				originalType: data.type,
				timestamp: Date.now(),
			});
		}
	} catch (error) {
		console.error("[Robot Worker] 处理失败:", error);
		parentPort.postMessage({
			type: "error",
			message: error.message,
			originalType: data?.type,
		});
	}
});

// 发送初始化完成消息
parentPort.postMessage({
	type: "ready",
	message: "Robot Worker 已就绪",
	pid: process.pid,
});

console.log("[Robot Worker] 启动完成, PID:", process.pid);
