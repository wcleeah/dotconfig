import type {
    Plugin,
    Event,
    TextPart,
    ToolPart,
} from "@opencode-ai/sdk";
import { initDatabase } from "./usage-tracker/schema";
import { createPluginState } from "./usage-tracker/state";
import {
    onSessionCreated,
    onSessionUpdated,
    onSessionIdle,
    onSessionDeleted,
} from "./usage-tracker/handlers/session";
import { onMessageUpdated } from "./usage-tracker/handlers/message";
import {
    onPartUpdated,
} from "./usage-tracker/handlers/part";

const DEFAULT_DB_PATH = `${process.env.HOME}/.config/opencode/usage.db`;

export const UsageTrackerPlugin: Plugin = async ({
    directory,
    worktree,
    client,
}) => {
    const db = initDatabase(process.env.OPENCODE_USAGE_DB || DEFAULT_DB_PATH);

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

                case "message.part.updated":
                    state = onPartUpdated(
                        db,
                        state,
                        event.properties.part,
                    );
                    break;
            }
        },
    };
};
