export interface Logger {
	info(message: string, fields?: Record<string, unknown>): void;
	debug(message: string, fields?: Record<string, unknown>): void;
	warning(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

interface LogEntry {
	level: "info" | "debug" | "warning" | "error";
	message: string;
	fields?: Record<string, unknown>;
}

export class ConsoleLogger implements Logger {
	info(message: string, fields?: Record<string, unknown>): void {
		console.log(
			JSON.stringify({
				level: "info",
				message,
				timestamp: new Date().toISOString(),
				...fields,
			}),
		);
	}
	debug(message: string, fields?: Record<string, unknown>): void {
		console.log(
			JSON.stringify({
				level: "debug",
				message,
				timestamp: new Date().toISOString(),
				...fields,
			}),
		);
	}
	warning(message: string, fields?: Record<string, unknown>): void {
		console.warn(
			JSON.stringify({
				level: "warning",
				message,
				timestamp: new Date().toISOString(),
				...fields,
			}),
		);
	}
	error(message: string, fields?: Record<string, unknown>): void {
		console.error(
			JSON.stringify({
				level: "error",
				message,
				timestamp: new Date().toISOString(),
				...fields,
			}),
		);
	}
}

export class TestLogger implements Logger {
	messages: LogEntry[] = [];
	info(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({ level: "info", message, fields });
	}
	debug(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({ level: "debug", message, fields });
	}
	warning(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({ level: "warning", message, fields });
	}
	error(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({ level: "error", message, fields });
	}
	clear(): void {
		this.messages = [];
	}
}
