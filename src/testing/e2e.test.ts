import { beforeEach, describe, expect, test } from "vitest";
import worker, { __setAppBotLoginForTests } from "../main";
import issuesAssigned from "./fixtures/issues-assigned.json";
import { buildSignedWebhookRequest } from "./workflow-test-helpers";

const TEST_SECRET = "test-webhook-secret";
const TEST_APP_ID = "123";
const TEST_PRIVATE_KEY =
	"-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----";

beforeEach(() => {
	__setAppBotLoginForTests("xmtp-coder-tasks[bot]");
});

describe("e2e: signed webhook → worker → workflow.create", () => {
	test("task_requested webhook is accepted and triggers workflow.create", async () => {
		const createCalls: Array<{ id: string; params: unknown }> = [];
		const env = {
			APP_ID: TEST_APP_ID,
			PRIVATE_KEY: TEST_PRIVATE_KEY,
			WEBHOOK_SECRET: TEST_SECRET,
			AGENT_GITHUB_USERNAME: "xmtp-coder-agent",
			CODER_URL: "https://coder.example.com",
			CODER_TOKEN: "tok",
			CODER_TASK_NAME_PREFIX: "gh",
			CODER_TEMPLATE_NAME: "task-template",
			CODER_TEMPLATE_NAME_CODEX: "task-template-codex",
			CODER_ORGANIZATION: "default",
			LOG_FORMAT: "json",
			CODER_TASK_WORKFLOW: {
				create: async (args: { id: string; params: unknown }) => {
					createCalls.push(args);
					return { id: args.id };
				},
			},
		} as unknown as Parameters<typeof worker.fetch>[1];

		const req = await buildSignedWebhookRequest({
			secret: TEST_SECRET,
			body: JSON.stringify(issuesAssigned),
			eventName: "issues",
			deliveryId: "e2e-delivery-1",
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);

		expect(res.status).toBe(202);
		expect(createCalls).toHaveLength(1);
		const [call] = createCalls;
		expect(call?.id).toMatch(/^task_requested-/);
		expect(call?.id).toContain("e2e-delivery-1");
	});
});
