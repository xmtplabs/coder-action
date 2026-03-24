import { describe, expect, test } from "bun:test";
import { ConsoleLogger, TestLogger } from "./logger";

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
    logger.warning("w");
    logger.error("e");
    expect(logger.messages).toHaveLength(4);
    expect(logger.messages[0].level).toBe("info");
    expect(logger.messages[1].level).toBe("debug");
    expect(logger.messages[2].level).toBe("warning");
    expect(logger.messages[3].level).toBe("error");
  });

  test("clear resets messages", () => {
    const logger = new TestLogger();
    logger.info("x");
    logger.clear();
    expect(logger.messages).toHaveLength(0);
  });
});

describe("ConsoleLogger", () => {
  test("implements Logger interface", () => {
    const logger = new ConsoleLogger();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warning).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
