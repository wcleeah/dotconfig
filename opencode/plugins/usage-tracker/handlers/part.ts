import type { Database } from "bun:sqlite";
import type { Part } from "@opencode-ai/sdk";
import type { PluginState } from "../types";
import { logError } from "../utils";

export const onPartUpdated = (
    db: Database,
    state: PluginState,
    part: Part,
): PluginState => {
    try {
        db.prepare(`
            INSERT OR REPLACE INTO parts (id, message_id, session_id, part_index, type, data, created_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            part.id,
            part.messageID,
            part.sessionID,
            part.index ?? 0,
            part.type,
            JSON.stringify(part),
            part.time?.start ?? Date.now(),
            part.time?.end ?? null,
        );

        return state;
    } catch (err) {
        logError(db, "message.part.updated", part, err);
        return state;
    }
};
