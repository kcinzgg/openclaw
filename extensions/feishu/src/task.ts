import type * as Lark from "@larksuiteoapi/node-sdk";
import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { createFeishuToolClient } from "./tool-account.js";
import { resolveToolsConfig } from "./tools-config.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

type LarkTaskResponse = {
  code?: number;
  msg?: string;
  data?: { task?: { guid?: string; summary?: string; description?: string; due?: unknown } };
};

const TASK_ACTION_VALUES = ["create"] as const;
const USER_ID_TYPE_VALUES = ["open_id", "user_id", "union_id"] as const;
const MEMBER_ROLE_VALUES = ["assignee", "follower"] as const;

export const FeishuTaskSchema = Type.Object({
  action: Type.Unsafe<(typeof TASK_ACTION_VALUES)[number]>({
    type: "string",
    enum: [...TASK_ACTION_VALUES],
    description: "Action: create (create a Feishu task)",
  }),
  summary: Type.String({
    description: "Task title (required). Max 256 characters.",
    maxLength: 256,
  }),
  description: Type.Optional(
    Type.String({ description: "Task description. Max 65536 characters." }),
  ),
  due: Type.Optional(
    Type.String({
      description: 'Due time (Unix timestamp in ms as string). Example: "1675742789470"',
    }),
  ),
  members: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String({
          description: "User ID (open_id, user_id, or union_id per user_id_type)",
        }),
        role: Type.Optional(
          Type.Unsafe<(typeof MEMBER_ROLE_VALUES)[number]>({
            type: "string",
            enum: [...MEMBER_ROLE_VALUES],
            description: "Role: assignee or follower",
          }),
        ),
      }),
      { description: "Task members (assignees/followers)" },
    ),
  ),
  user_id_type: Type.Optional(
    Type.Unsafe<(typeof USER_ID_TYPE_VALUES)[number]>({
      type: "string",
      enum: [...USER_ID_TYPE_VALUES],
      description: "User ID type for members (default: open_id)",
    }),
  ),
  accountId: Type.Optional(
    Type.String({ description: "Feishu account ID when multiple configured" }),
  ),
});

export type FeishuTaskParams = Static<typeof FeishuTaskSchema>;

/** Call Feishu Task v2 create API. Uses tenant_access_token via SDK client.request. */
async function createTask(
  client: Lark.Client,
  params: FeishuTaskParams,
): Promise<{ task_id: string; summary?: string; description?: string; due?: unknown }> {
  const body: Record<string, unknown> = {
    summary: params.summary,
  };
  if (params.description !== undefined && params.description !== "") {
    body.description = params.description;
  }
  if (params.due !== undefined && params.due !== "") {
    body.due = { timestamp: params.due };
  }
  if (params.members && params.members.length > 0) {
    body.members = params.members;
  }

  const requestOpts = {
    method: "POST" as const,
    url: "/open-apis/task/v2/tasks",
    data: body,
  };
  const query: Record<string, string> = {};
  if (params.user_id_type) {
    query.user_id_type = params.user_id_type;
  }

  let res: LarkTaskResponse;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK generic request
    res = (await (client as any).request(requestOpts, { params: query })) as LarkTaskResponse;
  } catch (err: unknown) {
    const data = (err as { response?: { data?: { code?: number; msg?: string } } })?.response?.data;
    if (data && typeof data.msg === "string") {
      throw new Error(
        `Feishu task API: ${data.msg}${data.code != null ? ` (code=${data.code})` : ""}`,
      );
    }
    throw err;
  }

  if (res.code !== 0) {
    throw new Error(res.msg ?? `Feishu task API error: code=${res.code}`);
  }

  const task = res.data?.task;
  if (!task?.guid) {
    throw new Error("Feishu task API returned no task guid");
  }

  return {
    task_id: task.guid,
    summary: task.summary,
    description: task.description,
    due: task.due,
  };
}

// ============ Tool Registration ============

export function registerFeishuTaskTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_task: No config available, skipping task tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_task: No Feishu accounts configured, skipping task tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.task) {
    api.logger.debug?.("feishu_task: task tool disabled in config (tools.task: true to enable)");
    return;
  }

  api.registerTool(
    (ctx) => ({
      name: "feishu_task",
      label: "Feishu Task",
      description:
        "Create a Feishu task (Task v2). Requires Feishu app permission '查看、创建、编辑和删除飞书任务' and tools.task: true.",
      parameters: FeishuTaskSchema,
      async execute(_toolCallId, rawParams) {
        const params = rawParams as FeishuTaskParams;
        try {
          const client = createFeishuToolClient({
            api,
            executeParams: { accountId: params.accountId },
            defaultAccountId: ctx.agentAccountId,
          });
          if (params.action === "create") {
            return json(await createTask(client, params));
          }
          return json({ error: `Unknown action: ${String(params.action)}` });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }),
    { name: "feishu_task" },
  );

  api.logger.info?.("feishu_task: Registered feishu_task tool");
}
