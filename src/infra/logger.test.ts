import { describe, expect, test, vi } from "vitest";
import { createLogger, TestLogger } from "./logger";

describe("TestLogger", () => {
	test("captures info messages", () => {
		const logger = new TestLogger();
		logger.info("hello");
		expect(logger.messages).toEqual([{ level: "info", message: "hello" }]);
	});

	test("captures all log levels", () => {
		const logger = new TestLogger();
		logger.info("i");
		logger.debug("d");
		logger.warn("w");
		logger.error("e");
		expect(logger.messages).toHaveLength(4);
		expect(logger.messages[0].level).toBe("info");
		expect(logger.messages[1].level).toBe("debug");
		expect(logger.messages[2].level).toBe("warn");
		expect(logger.messages[3].level).toBe("error");
	});

	test("clear resets messages", () => {
		const logger = new TestLogger();
		logger.info("x");
		logger.clear();
		expect(logger.messages).toHaveLength(0);
	});

	test("captures structured fields", () => {
		const logger = new TestLogger();
		logger.info("webhook received", {
			event: "issues",
			action: "assigned",
			delivery_id: "abc-123",
		});
		expect(logger.messages[0].fields).toEqual({
			event: "issues",
			action: "assigned",
			delivery_id: "abc-123",
		});
	});

	test("fields default to undefined when not provided", () => {
		const logger = new TestLogger();
		logger.info("simple message");
		expect(logger.messages[0].fields).toBeUndefined();
	});

	test("child logger shares messages array with parent", () => {
		const logger = new TestLogger();
		const child = logger.child({ requestId: "req-1" });
		child.info("from child");
		expect(logger.messages).toHaveLength(1);
		expect(logger.messages[0].fields).toEqual({ requestId: "req-1" });
	});

	test("child logger merges bindings with per-call fields", () => {
		const logger = new TestLogger();
		const child = logger.child({ requestId: "req-1" });
		child.info("webhook", { event: "issues" });
		expect(logger.messages[0].fields).toEqual({
			requestId: "req-1",
			event: "issues",
		});
	});
});

describe("createLogger", () => {
	test("returns a logger with all required methods", () => {
		const logger = createLogger({ logFormat: "json" });
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.child).toBe("function");
	});

	test("child returns a logger with all required methods", () => {
		const logger = createLogger({ logFormat: "json" });
		const child = logger.child({ requestId: "test" });
		expect(typeof child.info).toBe("function");
		expect(typeof child.debug).toBe("function");
		expect(typeof child.warn).toBe("function");
		expect(typeof child.error).toBe("function");
		expect(typeof child.child).toBe("function");
	});
});

describe("createLogger(json mode)", () => {
	test("emits a single JSON object per log call via console.log", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const logger = createLogger({ logFormat: "json" });
			logger.info("hello", { user_id: 42 });
			expect(spy).toHaveBeenCalledTimes(1);
			const arg = spy.mock.calls[0]?.[0];
			expect(typeof arg).toBe("string");
			const parsed = JSON.parse(arg as string);
			expect(parsed).toMatchObject({ level: "info", msg: "hello", user_id: 42 });
		} finally {
			spy.mockRestore();
		}
	});

	test("child logger merges bindings into every record", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const logger = createLogger({ logFormat: "json" }).child({
				deliveryId: "abc",
			});
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			try {
				logger.warn("boom");
				// warn in json mode still uses console.log (all levels go to console.log in JSON)
				// we allow either — check whichever spy received the payload.
				const call =
					spy.mock.calls[0]?.[0] ?? warnSpy.mock.calls[0]?.[0];
				expect(call).toBeTruthy();
				const parsed = JSON.parse(call as string);
				expect(parsed).toMatchObject({
					level: "warn",
					msg: "boom",
					deliveryId: "abc",
				});
			} finally {
				warnSpy.mockRestore();
			}
		} finally {
			spy.mockRestore();
		}
	});
});
