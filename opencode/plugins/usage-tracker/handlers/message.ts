import type { Database } from "bun:sqlite";
import type {
    Message,
    AssistantMessage,
    UserMessage,
    OpencodeClient,
    TextPart,
} from "@opencode-ai/sdk";
import type { PluginState } from "../types";
import { getCurrentTurnID } from "../state";
import { logError } from "../utils";

async function fetchMessageContent(
    client: OpencodeClient,
    sessionID: string,
    messageID: string,
): Promise<string | null> {
    try {
        const result = await client.session.message({
            path: { id: sessionID, messageID },
        });

        if (result.error || !result.data) {
            return null;
        }

        // Extract text content from text parts only
        const textParts = result.data.parts.filter(
            (p): p is TextPart => p.type === "text",
        );
        if (textParts.length === 0) {
            return null;
        }

        return textParts.map((p) => p.text).join("");
    } catch (err) {
        console.error("Failed to fetch message content:", err);
        return null;
    }
}

export const onMessageUpdated = async (
    db: Database,
    state: PluginState,
    message: Message,
    client: OpencodeClient,
): Promise<PluginState> => {
    try {
        // Skip if session is being compacted
        if (state.compactingSessions.has(message.sessionID)) {
            return state;
        }

        let turnID = getCurrentTurnID(state, message.sessionID);
        let newState = state;

        if (message.role === "assistant") {
            const msg = message as AssistantMessage;

            if (!msg.time.completed) {
                return state;
            }
            // Message is complete - fetch content from API and INSERT
            const content = await fetchMessageContent(
                client,
                msg.sessionID,
                msg.id,
            );

            db.prepare(`
          INSERT OR REPLACE INTO messages (
            id, session_id, turn_id, role, agent, content, model_id, provider_id,
            created_at, completed_at, input_tokens, output_tokens, reasoning_tokens,
            cache_read_tokens, cache_write_tokens, cost, finish_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
                msg.id,
                msg.sessionID,
                turnID,
                msg.role,
                msg.agent ?? null,
                content,
                msg.modelID,
                msg.providerID,
                msg.time.created,
                msg.time.completed,
                msg.tokens.input,
                msg.tokens.output,
                msg.tokens.reasoning,
                msg.tokens.cache.read,
                msg.tokens.cache.write,
                msg.cost,
                msg.finish ?? null,
            );

            // Update all tool calls associated with this message to include token usage
            db.prepare(`
              UPDATE tool_calls SET
                input_tokens = ?,
                output_tokens = ?,
                reasoning_tokens = ?,
                cache_read_tokens = ?,
                cache_write_tokens = ?,
                cost = ?
              WHERE message_id = ?
            `).run(
                msg.tokens.input,
                msg.tokens.output,
                msg.tokens.reasoning,
                msg.tokens.cache.read,
                msg.tokens.cache.write,
                msg.cost,
                msg.id
            );
        } else if (message.role === "user") {
            const msg = message as UserMessage;
            const parentID = state.sessionParentIDs.get(msg.sessionID);
            const isSubagentPrompt = parentID ? 1 : 0;

            // Fetch content for user messages (they don't stream, so fetch immediately)
            const content = await fetchMessageContent(client, msg.sessionID, msg.id);

            if (!isSubagentPrompt) {
                turnID = msg.id;

                db.prepare(`
          INSERT OR REPLACE INTO turns (id, session_id, parent_turn_id, user_message, started_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(turnID, msg.sessionID, null, null, msg.time.created);

                newState = {
                    ...state,
                    activeTurns: new Map(state.activeTurns).set(msg.sessionID, {
                        turnID,
                        sessionID: msg.sessionID,
                        startedAt: msg.time.created,
                    }),
                };
            }

            db.prepare(`
        INSERT OR REPLACE INTO messages (
          id, session_id, turn_id, role, agent, content, is_subagent_prompt, model_id, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                msg.id,
                msg.sessionID,
                turnID,
                msg.role,
                msg.agent ?? null,
                content,
                isSubagentPrompt,
                msg.model?.modelID ?? null,
                msg.model?.providerID ?? null,
                msg.time.created,
            );
        }

        return newState;
    } catch (err) {
        logError(db, "message.updated", message, err);
        return state;
    }
};
