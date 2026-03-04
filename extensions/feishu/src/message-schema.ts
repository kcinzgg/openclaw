import { Type, type Static } from "@sinclair/typebox";

const MESSAGE_ACTION_VALUES = ["list", "get"] as const;
const SORT_TYPE_VALUES = ["ByCreateTimeAsc", "ByCreateTimeDesc"] as const;
const CONTAINER_ID_TYPE_VALUES = ["chat", "thread"] as const;

export const FeishuMessageSchema = Type.Object({
  action: Type.Unsafe<(typeof MESSAGE_ACTION_VALUES)[number]>({
    type: "string",
    enum: [...MESSAGE_ACTION_VALUES],
    description: "Action: list (chat history or thread messages) | get (single message)",
  }),
  chat_id: Type.Optional(
    Type.String({
      description:
        'Chat ID, e.g. "oc_xxx". Required for list when container_id_type is "chat" (default).',
    }),
  ),
  thread_id: Type.Optional(
    Type.String({
      description:
        'Thread ID, e.g. "omt_xxx". Required for list when container_id_type is "thread". ' +
        "Use this to fetch all replies within a specific topic/thread.",
    }),
  ),
  container_id_type: Type.Optional(
    Type.Unsafe<(typeof CONTAINER_ID_TYPE_VALUES)[number]>({
      type: "string",
      enum: [...CONTAINER_ID_TYPE_VALUES],
      description:
        'Container type: "chat" (default, group/p2p messages) or "thread" (topic replies). ' +
        "When chat, only the root message of a thread is returned. " +
        "Use thread + thread_id to get all replies in a topic.",
    }),
  ),
  message_id: Type.Optional(Type.String({ description: "Message ID (required for get)" })),
  start_time: Type.Optional(
    Type.String({
      description:
        'Start time. Accepts date string (e.g. "2026-03-01", "2026-03-01T09:00:00+08:00") ' +
        'or Unix epoch seconds (e.g. "1772294400"). Dates without timezone are treated as Asia/Shanghai (CST, UTC+8). ' +
        'A date like "2026-03-01" becomes the start of that day (00:00:00 CST). ' +
        'For list with container_id_type="chat" only. Thread type does NOT support time range. ' +
        "IMPORTANT: Prefer passing date strings instead of computing timestamps yourself.",
    }),
  ),
  end_time: Type.Optional(
    Type.String({
      description:
        'End time. Accepts date string (e.g. "2026-03-01", "2026-03-01T23:59:59+08:00") ' +
        'or Unix epoch seconds (e.g. "1772380799"). Dates without timezone are treated as Asia/Shanghai (CST, UTC+8). ' +
        'A date like "2026-03-01" becomes the end of that day (23:59:59 CST). ' +
        'For list with container_id_type="chat" only. Thread type does NOT support time range. ' +
        "IMPORTANT: Prefer passing date strings instead of computing timestamps yourself.",
    }),
  ),
  sort_type: Type.Optional(
    Type.Unsafe<(typeof SORT_TYPE_VALUES)[number]>({
      type: "string",
      enum: [...SORT_TYPE_VALUES],
      description: "Sort order (default: ByCreateTimeDesc)",
    }),
  ),
  page_size: Type.Optional(Type.Number({ description: "Page size (1-50, default 20)" })),
  page_token: Type.Optional(Type.String({ description: "Pagination token" })),
  expand_threads: Type.Optional(
    Type.Boolean({
      description:
        "Auto-expand thread/topic replies when listing chat messages (default: true). " +
        "When enabled, messages with thread_id will include a thread_replies array. " +
        "Set to false to skip thread expansion for faster results.",
    }),
  ),
});

export type FeishuMessageParams = Static<typeof FeishuMessageSchema>;
