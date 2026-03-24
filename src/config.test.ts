import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const validEnv = {
  APP_ID: "12345",
  PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
  WEBHOOK_SECRET: "whsec_test",
  AGENT_GITHUB_USERNAME: "xmtp-coder-agent",
  CODER_URL: "https://coder.example.com",
  CODER_TOKEN: "coder-token-123",
  CODER_TASK_NAME_PREFIX: "gh",
  CODER_TEMPLATE_NAME: "task-template",
  CODER_ORGANIZATION: "default",
  PORT: "3000",
};

describe("loadConfig", () => {
  test("parses valid environment", () => {
    const config = loadConfig(validEnv);
    expect(config.appId).toBe("12345");
    expect(config.privateKey).toContain("RSA PRIVATE KEY");
    expect(config.webhookSecret).toBe("whsec_test");
    expect(config.agentGithubUsername).toBe("xmtp-coder-agent");
    expect(config.coderURL).toBe("https://coder.example.com");
    expect(config.coderToken).toBe("coder-token-123");
    expect(config.port).toBe(3000);
  });

  test("applies defaults for optional fields", () => {
    const minimal = {
      APP_ID: "1",
      PRIVATE_KEY: "key",
      WEBHOOK_SECRET: "secret",
      CODER_URL: "https://coder.test",
      CODER_TOKEN: "tok",
    };
    const config = loadConfig(minimal);
    expect(config.agentGithubUsername).toBe("xmtp-coder-agent");
    expect(config.coderTaskNamePrefix).toBe("gh");
    expect(config.coderTemplateName).toBe("task-template");
    expect(config.coderOrganization).toBe("default");
    expect(config.port).toBe(3000);
  });

  test("throws on missing required field", () => {
    const { APP_ID: _, ...missing } = validEnv;
    expect(() => loadConfig(missing)).toThrow();
  });

  test("throws on invalid CODER_URL", () => {
    expect(() => loadConfig({ ...validEnv, CODER_URL: "not-a-url" })).toThrow();
  });

  test("does not include secrets in error messages", () => {
    try {
      loadConfig({ ...validEnv, CODER_URL: "not-a-url" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("coder-token-123");
      expect(msg).not.toContain("RSA PRIVATE KEY");
    }
  });
});
