import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFeishuTaskTools } from "./task.js";

const requestMock = vi.hoisted(() => vi.fn());
const createFeishuClientMock = vi.hoisted(() => vi.fn(() => ({ request: requestMock })));

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

function createConfig(opts: { task?: boolean; hasAccount?: boolean }) {
  const tools = opts.task === false ? { task: false } : { task: true };
  const base = {
    channels: {
      feishu: {
        enabled: true,
        appId: "cli_test",
        appSecret: "secret",
        tools: opts.hasAccount === false ? undefined : tools,
      },
    },
  };
  if (opts.hasAccount === false) {
    (base.channels as { feishu: Record<string, unknown> }).feishu.appId = undefined;
    (base.channels as { feishu: Record<string, unknown> }).feishu.appSecret = undefined;
  }
  return base;
}

describe("registerFeishuTaskTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockResolvedValue({
      code: 0,
      data: { task: { guid: "task_abc", summary: "Test task" } },
    });
  });

  it("registers feishu_task when tools.task is true and calls create API on execute", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: createConfig({ task: true }) as never,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const factory = registerTool.mock.calls[0]?.[0];
    expect(typeof factory).toBe("function");
    const tool = factory({ agentAccountId: undefined });
    expect(tool?.name).toBe("feishu_task");

    const result = await tool.execute("tc_1", {
      action: "create",
      summary: "My new task",
    });
    expect(result.details).toEqual(
      expect.objectContaining({ task_id: "task_abc", summary: "Test task" }),
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      method: "POST",
      url: "/open-apis/task/v2/tasks",
      data: { summary: "My new task" },
    });
  });

  it("sends due as timestamp object and members when provided", async () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: createConfig({ task: true }) as never,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);
    const factory = registerTool.mock.calls[0]?.[0];
    const tool = factory({ agentAccountId: undefined });
    await tool.execute("tc_1", {
      action: "create",
      summary: "Task with due and members",
      due: "1675742789470",
      members: [{ id: "ou_1", role: "assignee" }],
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0]?.[0].data).toEqual({
      summary: "Task with due and members",
      due: { timestamp: "1675742789470" },
      members: [{ id: "ou_1", role: "assignee" }],
    });
  });

  it("skips registration when tools.task is false", () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: createConfig({ task: false }) as never,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("skips registration when no config", () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: undefined,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("skips registration when no enabled Feishu account", () => {
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: createConfig({ hasAccount: false }) as never,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("returns error in details when API returns code !== 0", async () => {
    requestMock.mockResolvedValueOnce({ code: 1470416, msg: "title and rich_summary are empty" });
    const registerTool = vi.fn();
    registerFeishuTaskTools({
      config: createConfig({ task: true }) as never,
      logger: { debug: vi.fn(), info: vi.fn() } as never,
      registerTool,
    } as never);
    const factory = registerTool.mock.calls[0]?.[0];
    const tool = factory({ agentAccountId: undefined });
    const result = await tool.execute("tc_1", { action: "create", summary: "x" });
    expect(result.details).toEqual(
      expect.objectContaining({ error: expect.stringContaining("title and rich_summary") }),
    );
  });
});
