/**
 * 远程控制指令二进制协议
 * 消息类型: 0x10 - REMOTE_CONTROL_COMMAND
 * 格式: [2字节 messageType] [2字节 commandType] [2字节 flags] [变长数据]
 */

// 消息类型定义
export const MESSAGE_TYPE = {
	REMOTE_CONTROL_COMMAND: 0x10,
};

// 控制指令类型定义
export const COMMAND_TYPE = {
	// 鼠标事件 0x01-0x0F
	MOUSE_MOVE: 0x01,
	MOUSE_DRAG: 0x02,
	MOUSE_DOWN: 0x03,
	MOUSE_UP: 0x04,
	DOUBLE_CLICK: 0x06,
	CONTEXT_MENU: 0x07,
	LONG_PRESS: 0x08,
	SCROLL: 0x09,

	// 键盘事件 0x10-0x1F
	KEY_DOWN: 0x10,
	KEY_UP: 0x11,
	KEY_PRESS: 0x12,
	KEY_TYPE: 0x13,
	SHORTCUT: 0x14,
	FUNCTION_KEY: 0x15,
};

// 标志位定义
export const FLAGS = {
	HAS_COORDINATES: 0x01, // 包含坐标信息
	HAS_BUTTON: 0x02, // 包含按键信息
	HAS_KEY: 0x04, // 包含按键名称
	HAS_TEXT: 0x08, // 包含文本内容
	HAS_MODIFIERS: 0x10, // 包含修饰键
	HAS_PLATFORM: 0x20, // 包含平台信息
	HAS_VIDEO_RESOLUTION: 0x40, // 包含视频分辨率
	HAS_SCREEN_INFO: 0x80, // 包含屏幕信息
	HAS_SCROLL_DATA: 0x100, // 包含滚轮数据 (deltaX, deltaY, deltaMode)
};

// 按键类型定义
export const BUTTON_TYPE = {
	LEFT: 0x01,
	MIDDLE: 0x02,
	RIGHT: 0x03,
};

// 修饰键标志
export const MODIFIER_FLAGS = {
	CTRL: 0x01,
	ALT: 0x02,
	SHIFT: 0x04,
	META: 0x08,
};

/**
 * 将字符串编码为UTF-8字节数组
 */
function encodeString(str) {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(str);
	const result = new Uint8Array(2 + bytes.length);
	// 2字节长度前缀（小端序）
	result[0] = bytes.length & 0xff;
	result[1] = (bytes.length >> 8) & 0xff;
	result.set(bytes, 2);
	return result;
}

/**
 * 从字节数组解码UTF-8字符串
 */
function decodeString(buffer, offset) {
	const length = buffer[offset] | (buffer[offset + 1] << 8);
	const decoder = new TextDecoder();
	const bytes = buffer.slice(offset + 2, offset + 2 + length);
	return {
		value: decoder.decode(bytes),
		nextOffset: offset + 2 + length,
	};
}

/**
 * 写入16位整数（小端序）
 */
function writeUint16(buffer, offset, value) {
	buffer[offset] = value & 0xff;
	buffer[offset + 1] = (value >> 8) & 0xff;
}

/**
 * 读取16位整数（小端序）
 */
function readUint16(buffer, offset) {
	return buffer[offset] | (buffer[offset + 1] << 8);
}

/**
 * 写入32位整数（小端序）
 */
function writeUint32(buffer, offset, value) {
	buffer[offset] = value & 0xff;
	buffer[offset + 1] = (value >> 8) & 0xff;
	buffer[offset + 2] = (value >> 16) & 0xff;
	buffer[offset + 3] = (value >> 24) & 0xff;
}

/**
 * 读取32位整数（小端序）
 */
function readUint32(buffer, offset) {
	return (
		buffer[offset] |
		(buffer[offset + 1] << 8) |
		(buffer[offset + 2] << 16) |
		(buffer[offset + 3] << 24)
	);
}

/**
 * 写入32位有符号整数（小端序）
 */
function writeInt32(buffer, offset, value) {
	// 转换为有符号32位整数
	const int32 = value | 0;
	buffer[offset] = int32 & 0xff;
	buffer[offset + 1] = (int32 >> 8) & 0xff;
	buffer[offset + 2] = (int32 >> 16) & 0xff;
	buffer[offset + 3] = (int32 >> 24) & 0xff;
}

/**
 * 读取32位有符号整数（小端序）
 */
function readInt32(buffer, offset) {
	const value =
		buffer[offset] |
		(buffer[offset + 1] << 8) |
		(buffer[offset + 2] << 16) |
		(buffer[offset + 3] << 24);
	// 转换为有符号整数
	return value | 0;
}

/**
 * 编码远程控制指令为二进制格式
 */
export function encodeControlCommand(command) {
	try {
		console.log("[控制协议] 编码指令:", command.type);

		// 确定指令类型
		let commandType;
		switch (command.type) {
			case "mousemove":
				commandType = COMMAND_TYPE.MOUSE_MOVE;
				break;
			case "mousedrag":
				commandType = COMMAND_TYPE.MOUSE_DRAG;
				break;
			case "mousedown":
				commandType = COMMAND_TYPE.MOUSE_DOWN;
				break;
			case "mouseup":
				commandType = COMMAND_TYPE.MOUSE_UP;
				break;
			case "doubleclick":
				commandType = COMMAND_TYPE.DOUBLE_CLICK;
				break;
			case "contextmenu":
				commandType = COMMAND_TYPE.CONTEXT_MENU;
				break;
			case "longpress":
				commandType = COMMAND_TYPE.LONG_PRESS;
				break;
			case "scroll":
				commandType = COMMAND_TYPE.SCROLL;
				break;
			case "keydown":
				commandType = COMMAND_TYPE.KEY_DOWN;
				break;
			case "keyup":
				commandType = COMMAND_TYPE.KEY_UP;
				break;
			case "keypress":
				commandType = COMMAND_TYPE.KEY_PRESS;
				break;
			case "keytype":
				commandType = COMMAND_TYPE.KEY_TYPE;
				break;
			case "shortcut":
				commandType = COMMAND_TYPE.SHORTCUT;
				break;
			case "functionkey":
				commandType = COMMAND_TYPE.FUNCTION_KEY;
				break;
			default:
				throw new Error(`未知指令类型: ${command.type}`);
		}

		// 计算标志位
		let flags = 0;
		if (typeof command.x === "number" && typeof command.y === "number") {
			flags |= FLAGS.HAS_COORDINATES;
		}
		if (command.button) {
			flags |= FLAGS.HAS_BUTTON;
		}
		if (command.key) {
			flags |= FLAGS.HAS_KEY;
		}
		if (command.text) {
			flags |= FLAGS.HAS_TEXT;
		}
		if (
			command.ctrlKey ||
			command.altKey ||
			command.shiftKey ||
			command.metaKey
		) {
			flags |= FLAGS.HAS_MODIFIERS;
		}
		if (command.clientPlatform) {
			flags |= FLAGS.HAS_PLATFORM;
		}
		if (command.videoResolution) {
			flags |= FLAGS.HAS_VIDEO_RESOLUTION;
		}
		if (command.screenInfo) {
			flags |= FLAGS.HAS_SCREEN_INFO;
		}
		// 检查滚轮数据（针对scroll命令）
		if (
			commandType === COMMAND_TYPE.SCROLL &&
			(typeof command.deltaX === "number" ||
				typeof command.deltaY === "number" ||
				typeof command.deltaMode === "number")
		) {
			flags |= FLAGS.HAS_SCROLL_DATA;
		}

		// 计算所需缓冲区大小
		let totalSize = 6; // 基础头部：2字节messageType + 2字节commandType + 2字节flags

		// 坐标信息 (8字节: x,y各4字节)
		if (flags & FLAGS.HAS_COORDINATES) {
			totalSize += 8;
		}

		// 按键信息 (1字节)
		if (flags & FLAGS.HAS_BUTTON) {
			totalSize += 1;
		}

		// 按键名称 (变长字符串)
		let keyBytes = null;
		if (flags & FLAGS.HAS_KEY) {
			keyBytes = encodeString(command.key);
			totalSize += keyBytes.length;
		}

		// 文本内容 (变长字符串)
		let textBytes = null;
		if (flags & FLAGS.HAS_TEXT) {
			textBytes = encodeString(command.text);
			totalSize += textBytes.length;
		}

		// 修饰键 (1字节)
		if (flags & FLAGS.HAS_MODIFIERS) {
			totalSize += 1;
		}

		// 平台信息 (变长字符串)
		let platformBytes = null;
		if (flags & FLAGS.HAS_PLATFORM) {
			platformBytes = encodeString(command.clientPlatform);
			totalSize += platformBytes.length;
		}

		// 视频分辨率 (8字节: width,height各4字节)
		if (flags & FLAGS.HAS_VIDEO_RESOLUTION) {
			totalSize += 8;
		}

		// 屏幕信息 (JSON字符串，变长)
		let screenInfoBytes = null;
		if (flags & FLAGS.HAS_SCREEN_INFO) {
			screenInfoBytes = encodeString(JSON.stringify(command.screenInfo));
			totalSize += screenInfoBytes.length;
		}

		// 滚轮数据 (16字节: deltaX,deltaY,deltaMode,deltaZ各4字节)
		if (flags & FLAGS.HAS_SCROLL_DATA) {
			totalSize += 16;
		}

		// 创建缓冲区并编码数据
		const buffer = new Uint8Array(totalSize);
		let offset = 0;

		// 写入头部
		writeUint16(buffer, offset, MESSAGE_TYPE.REMOTE_CONTROL_COMMAND);
		offset += 2;
		writeUint16(buffer, offset, commandType);
		offset += 2;
		writeUint16(buffer, offset, flags);
		offset += 2;

		// 写入坐标
		if (flags & FLAGS.HAS_COORDINATES) {
			writeUint32(buffer, offset, Math.round(command.x));
			offset += 4;
			writeUint32(buffer, offset, Math.round(command.y));
			offset += 4;
		}

		// 写入按键
		if (flags & FLAGS.HAS_BUTTON) {
			let buttonCode = 0;
			switch (command.button) {
				case "left":
					buttonCode = BUTTON_TYPE.LEFT;
					break;
				case "middle":
					buttonCode = BUTTON_TYPE.MIDDLE;
					break;
				case "right":
					buttonCode = BUTTON_TYPE.RIGHT;
					break;
			}
			buffer[offset] = buttonCode;
			offset += 1;
		}

		// 写入按键名称
		if (flags & FLAGS.HAS_KEY) {
			buffer.set(keyBytes, offset);
			offset += keyBytes.length;
		}

		// 写入文本内容
		if (flags & FLAGS.HAS_TEXT) {
			buffer.set(textBytes, offset);
			offset += textBytes.length;
		}

		// 写入修饰键
		if (flags & FLAGS.HAS_MODIFIERS) {
			let modifierFlags = 0;
			if (command.ctrlKey) modifierFlags |= MODIFIER_FLAGS.CTRL;
			if (command.altKey) modifierFlags |= MODIFIER_FLAGS.ALT;
			if (command.shiftKey) modifierFlags |= MODIFIER_FLAGS.SHIFT;
			if (command.metaKey) modifierFlags |= MODIFIER_FLAGS.META;
			buffer[offset] = modifierFlags;
			offset += 1;
		}

		// 写入平台信息
		if (flags & FLAGS.HAS_PLATFORM) {
			buffer.set(platformBytes, offset);
			offset += platformBytes.length;
		}

		// 写入视频分辨率
		if (flags & FLAGS.HAS_VIDEO_RESOLUTION) {
			writeUint32(buffer, offset, command.videoResolution.width);
			offset += 4;
			writeUint32(buffer, offset, command.videoResolution.height);
			offset += 4;
		}

		// 写入屏幕信息
		if (flags & FLAGS.HAS_SCREEN_INFO) {
			buffer.set(screenInfoBytes, offset);
			offset += screenInfoBytes.length;
		}

		// 写入滚轮数据
		if (flags & FLAGS.HAS_SCROLL_DATA) {
			// deltaX (4字节, 有符号)
			writeInt32(buffer, offset, Math.round(command.deltaX || 0));
			offset += 4;
			// deltaY (4字节, 有符号)
			writeInt32(buffer, offset, Math.round(command.deltaY || 0));
			offset += 4;
			// deltaMode (4字节, 无符号)
			writeUint32(buffer, offset, command.deltaMode || 0);
			offset += 4;
			// deltaZ (4字节, 有符号)
			writeInt32(buffer, offset, Math.round(command.deltaZ || 0));
			offset += 4;
		}

		console.log(
			`[控制协议] 编码完成，大小: ${buffer.length}字节 (原JSON约${JSON.stringify(command).length}字节)`,
		);
		return buffer;
	} catch (error) {
		console.error("[控制协议] 编码失败:", error);
		throw error;
	}
}

/**
 * 解码二进制格式的远程控制指令
 */
export function decodeControlCommand(buffer) {
	try {
		console.log(`[控制协议] 解码二进制消息，大小: ${buffer.length}字节`);

		if (buffer.length < 6) {
			throw new Error("消息太短，至少需要6字节");
		}

		let offset = 0;

		// 读取头部
		const messageType = readUint16(buffer, offset);
		offset += 2;

		if (messageType !== MESSAGE_TYPE.REMOTE_CONTROL_COMMAND) {
			throw new Error(`无效的消息类型: 0x${messageType.toString(16)}`);
		}

		const commandType = readUint16(buffer, offset);
		offset += 2;
		const flags = readUint16(buffer, offset);
		offset += 2;

		// 确定指令类型字符串
		let type;
		switch (commandType) {
			case COMMAND_TYPE.MOUSE_MOVE:
				type = "mousemove";
				break;
			case COMMAND_TYPE.MOUSE_DRAG:
				type = "mousedrag";
				break;
			case COMMAND_TYPE.MOUSE_DOWN:
				type = "mousedown";
				break;
			case COMMAND_TYPE.MOUSE_UP:
				type = "mouseup";
				break;
			case COMMAND_TYPE.DOUBLE_CLICK:
				type = "doubleclick";
				break;
			case COMMAND_TYPE.CONTEXT_MENU:
				type = "contextmenu";
				break;
			case COMMAND_TYPE.LONG_PRESS:
				type = "longpress";
				break;
			case COMMAND_TYPE.SCROLL:
				type = "scroll";
				break;
			case COMMAND_TYPE.KEY_DOWN:
				type = "keydown";
				break;
			case COMMAND_TYPE.KEY_UP:
				type = "keyup";
				break;
			case COMMAND_TYPE.KEY_PRESS:
				type = "keypress";
				break;
			case COMMAND_TYPE.KEY_TYPE:
				type = "keytype";
				break;
			case COMMAND_TYPE.SHORTCUT:
				type = "shortcut";
				break;
			case COMMAND_TYPE.FUNCTION_KEY:
				type = "functionkey";
				break;
			default:
				throw new Error(`未知指令类型: 0x${commandType.toString(16)}`);
		}

		const command = { type };

		// 读取坐标
		if (flags & FLAGS.HAS_COORDINATES) {
			command.x = readUint32(buffer, offset);
			offset += 4;
			command.y = readUint32(buffer, offset);
			offset += 4;
		}

		// 读取按键
		if (flags & FLAGS.HAS_BUTTON) {
			const buttonCode = buffer[offset];
			offset += 1;
			switch (buttonCode) {
				case BUTTON_TYPE.LEFT:
					command.button = "left";
					break;
				case BUTTON_TYPE.MIDDLE:
					command.button = "middle";
					break;
				case BUTTON_TYPE.RIGHT:
					command.button = "right";
					break;
			}
		}

		// 读取按键名称
		if (flags & FLAGS.HAS_KEY) {
			const result = decodeString(buffer, offset);
			command.key = result.value;
			offset = result.nextOffset;
		}

		// 读取文本内容
		if (flags & FLAGS.HAS_TEXT) {
			const result = decodeString(buffer, offset);
			command.text = result.value;
			offset = result.nextOffset;
		}

		// 读取修饰键
		if (flags & FLAGS.HAS_MODIFIERS) {
			const modifierFlags = buffer[offset];
			offset += 1;
			command.ctrlKey = !!(modifierFlags & MODIFIER_FLAGS.CTRL);
			command.altKey = !!(modifierFlags & MODIFIER_FLAGS.ALT);
			command.shiftKey = !!(modifierFlags & MODIFIER_FLAGS.SHIFT);
			command.metaKey = !!(modifierFlags & MODIFIER_FLAGS.META);
		}

		// 读取平台信息
		if (flags & FLAGS.HAS_PLATFORM) {
			const result = decodeString(buffer, offset);
			command.clientPlatform = result.value;
			offset = result.nextOffset;
		}

		// 读取视频分辨率
		if (flags & FLAGS.HAS_VIDEO_RESOLUTION) {
			command.videoResolution = {
				width: readUint32(buffer, offset),
				height: readUint32(buffer, offset + 4),
			};
			offset += 8;
		}

		// 读取屏幕信息
		if (flags & FLAGS.HAS_SCREEN_INFO) {
			const result = decodeString(buffer, offset);
			command.screenInfo = JSON.parse(result.value);
			offset = result.nextOffset;
		}

		// 读取滚轮数据
		if (flags & FLAGS.HAS_SCROLL_DATA) {
			command.deltaX = readInt32(buffer, offset);
			offset += 4;
			command.deltaY = readInt32(buffer, offset);
			offset += 4;
			command.deltaMode = readUint32(buffer, offset);
			offset += 4;
			command.deltaZ = readInt32(buffer, offset);
			offset += 4;
		}

		console.log("[控制协议] 解码完成:", command.type);
		return command;
	} catch (error) {
		console.error("[控制协议] 解码失败:", error);
		throw error;
	}
}

/**
 * 检测数据是否为二进制控制协议格式
 */
export function isBinaryControlCommand(data) {
	if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
		return false;
	}

	const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

	if (buffer.length < 2) {
		return false;
	}

	const messageType = readUint16(buffer, 0);
	return messageType === MESSAGE_TYPE.REMOTE_CONTROL_COMMAND;
}
