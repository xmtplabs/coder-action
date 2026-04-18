export interface Logger {
	info(message: string, fields?: Record<string, unknown>): void;
	debug(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
	logFormat?: string;
}

/**
 * Creates a lightweight structured logger for Cloudflare Workers.
 *
 * In JSON mode (`logFormat: "json"`, default in production), each call emits a
 * single `console.log(JSON.stringify({level, msg, ...bindings, ...fields}))` —
 * this matches Cloudflare's Workers Logs recommendation: log plain objects to
 * `console.*` and Workers Logs auto-indexes every field as a queryable dimension.
 * Without any third-party library the bundle stays lean and everything runs
 * natively in workerd (no Node.js TTY/filesystem dependencies).
 *
 * In any other mode (local dev), a readable `[level] msg { fields }` line is
 * printed via the matching `console.*` method (info/warn/error).
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
	const json = options?.logFormat === "json";
	return makeLogger({}, json);
}

function makeLogger(
	bindings: Record<string, unknown>,
	json: boolean,
): Logger {
	const emit = (
		level: "debug" | "info" | "warn" | "error",
		msg: string,
		fields?: Record<string, unknown>,
	) => {
		const record = { level, msg, ...bindings, ...(fields ?? {}) };
		if (json) {
			console.log(JSON.stringify(record));
			return;
		}
		// Pretty local-dev line: "[level] msg <json-fields-if-any>"
		const merged = { ...bindings, ...(fields ?? {}) };
		const fieldStr = Object.keys(merged).length > 0
			? ` ${JSON.stringify(merged)}`
			: "";
		const prefix = `[${level}] ${msg}${fieldStr}`;
		if (level === "error") console.error(prefix);
		else if (level === "warn") console.warn(prefix);
		else console.log(prefix);
	};
	return {
		info: (m, f) => emit("info", m, f),
		debug: (m, f) => emit("debug", m, f),
		warn: (m, f) => emit("warn", m, f),
		error: (m, f) => emit("error", m, f),
		child: (b) => makeLogger({ ...bindings, ...b }, json),
	};
}

// ── Test logger ─────────────────────────────────────────────────────────────

interface LogEntry {
	level: "info" | "debug" | "warn" | "error";
	message: string;
	fields?: Record<string, unknown>;
}

export class TestLogger implements Logger {
	messages: LogEntry[] = [];

	constructor(private readonly bindings?: Record<string, unknown>) {}

	info(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({
			level: "info",
			message,
			fields: this.mergeFields(fields),
		});
	}
	debug(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({
			level: "debug",
			message,
			fields: this.mergeFields(fields),
		});
	}
	warn(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({
			level: "warn",
			message,
			fields: this.mergeFields(fields),
		});
	}
	error(message: string, fields?: Record<string, unknown>): void {
		this.messages.push({
			level: "error",
			message,
			fields: this.mergeFields(fields),
		});
	}
	child(bindings: Record<string, unknown>): TestLogger {
		const childLogger = new TestLogger({
			...this.bindings,
			...bindings,
		});
		childLogger.messages = this.messages;
		return childLogger;
	}
	clear(): void {
		this.messages = [];
	}

	private mergeFields(
		fields?: Record<string, unknown>,
	): Record<string, unknown> | undefined {
		if (!this.bindings && !fields) return undefined;
		if (!this.bindings) return fields;
		if (!fields) return { ...this.bindings };
		return { ...this.bindings, ...fields };
	}
}
