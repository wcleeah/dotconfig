import type {
    Plugin,
    Event,
    TextPart,
    ToolPart,
    CompactionPart,
} from "@opencode-ai/sdk";
import { initDatabase } from "./usage-tracker/schema";
import { createPluginState } from "./usage-tracker/state";
import {
    onSessionCreated,
    onSessionUpdated,
    onSessionIdle,
    onSessionDeleted,
    onSessionCompacting,
    onSessionCompacted,
} from "./usage-tracker/handlers/session";
import { onMessageUpdated } from "./usage-tracker/handlers/message";
import {
    onTextPart,
    onToolPart,
    onCompactionPart,
} from "./usage-tracker/handlers/part";
import { onToolExecuteBefore } from "./usage-tracker/handlers/tool";

const DEFAULT_DB_PATH = `${process.env.HOME}/.config/opencode/usage.db`;

export const UsageTrackerPlugin: Plugin = async ({
    directory,
    worktree,
    client,
}) => {
    const db = initDatabase(process.env.OPENCODE_USAGE_DB || DEFAULT_DB_PATH);

    // Start with empty state - historical data migration is handled separately by migrate.ts
    // Run: bun run ~/.config/opencode/plugins/migrate.ts
    let state = createPluginState();

    return {
        event: async ({ event }: { event: Event }) => {
            switch (event.type) {
                case "session.created":
                    state = onSessionCreated(
                        db,
                        state,
                        event.properties.info,
                        directory,
                        worktree,
                    );
                    break;

                case "session.updated":
                    state = onSessionUpdated(db, state, event.properties.info);
                    break;

                case "session.idle":
                    state = onSessionIdle(
                        db,
                        state,
                        event.properties.sessionID,
                    );
                    break;

                case "session.deleted":
                    state = onSessionDeleted(db, state, event.properties.info);
                    break;

                case "message.updated":
                    state = await onMessageUpdated(
                        db,
                        state,
                        event.properties.info,
                        client,
                    );
                    break;

                case "message.part.updated": {
                    const part = event.properties.part;
                    if (part.type === "tool") {
                        state = onToolPart(db, state, part as ToolPart);
                    } else if (part.type === "compaction") {
                        state = onCompactionPart(
                            db,
                            state,
                            part as CompactionPart,
                        );
                    }
                    break;
                }

                case "session.compacted":
                    state = onSessionCompacted(
                        db,
                        state,
                        event.properties.sessionID,
                    );
                    break;
            }
        },

        "experimental.session.compacting": async (input: {
            sessionID: string;
        }) => {
            state = onSessionCompacting(db, state, input.sessionID);
        },

        "tool.execute.before": async (
            input: { tool: string; sessionID: string; callID: string },
            output: { args: unknown },
        ) => {
            state = onToolExecuteBefore(
                db,
                state,
                input.callID,
                input.sessionID,
                input.tool,
                output.args,
            );
        },
    };
};
