import pino from "pino";
import pinoPretty from "pino-pretty";

export interface Logger {
	info(message: string, fields?: Record<string, unknown>): void;
	debug(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): Logger;
}

/**
 * Wraps a Pino instance to conform to the Logger interface.
 * Pino's native API is `logger.info(mergingObject, message)` — this wrapper
 * adapts it to `logger.info(message, fields?)` used throughout the codebase.
 */
function wrapPino(pinoLogger: pino.Logger): Logger {
	return {
		info(message: string, fields?: Record<string, unknown>): void {
			if (fields) {
				pinoLogger.info(fields, message);
			} else {
				pinoLogger.info(message);
			}
		},
		debug(message: string, fields?: Record<string, unknown>): void {
			if (fields) {
				pinoLogger.debug(fields, message);
			} else {
				pinoLogger.debug(message);
			}
		},
		warn(message: string, fields?: Record<string, unknown>): void {
			if (fields) {
				pinoLogger.warn(fields, message);
			} else {
				pinoLogger.warn(message);
			}
		},
		error(message: string, fields?: Record<string, unknown>): void {
			if (fields) {
				pinoLogger.error(fields, message);
			} else {
				pinoLogger.error(message);
			}
		},
		child(bindings: Record<string, unknown>): Logger {
			return wrapPino(pinoLogger.child(bindings));
		},
	};
}

export interface CreateLoggerOptions {
	logFormat?: string;
}

/**
 * Creates a Pino-backed Logger.
 *
 * - `logFormat: "json"` → structured JSON output (default for production)
 * - Any other value or omitted → human-readable output via pino-pretty (local dev)
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
	const useJson = options?.logFormat === "json";

	const pinoLogger = useJson ? pino() : pino(pinoPretty({ colorize: true }));

	return wrapPino(pinoLogger);
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
