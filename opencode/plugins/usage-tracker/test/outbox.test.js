import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'

import { describe, expect, it } from 'bun:test'

import { createOutbox } from '../outbox.js'

describe('outbox', () => {
  it('writes final json files and ignores tmp files when listing', () => {
    const home = mkdtempSync(join(tmpdir(), 'usage-tracker-home-'))

    try {
      const outbox = createOutbox('pid-test')
      const persisted = outbox.persist({
        batchID: 'batch-1',
        createdAt: 1000,
        facts: {
          projects: [],
          sessions: [],
          turns: [],
          responses: [],
          response_parts: [],
          llm_steps: [],
          tool_calls: [],
          tool_payloads: [],
        },
        touched: {
          projectIDs: [],
          sessionIDs: [],
          rootSessionIDs: [],
          days: [],
          modelKeys: [],
          toolKeys: [],
        },
      })
      const persistedPath = persisted.file

      writeFileSync(join(outbox.processDir, 'dangling.json.tmp'), '{"partial":true}')

      expect(persistedPath).toBe(join(homedir(), '.local', 'share', 'opencode', 'usage-outbox', 'pid-test', '000000000001-batch-1.json'))
      expect(persisted.sequence).toBe(1)
      expect(outbox.list()).toEqual([persistedPath])
      expect(JSON.parse(readFileSync(persistedPath, 'utf8'))).toMatchObject({
        batchID: 'batch-1',
        sequence: 1,
        factsAppliedAt: null,
      })
    } finally {
      rmSync(join(homedir(), '.local', 'share', 'opencode', 'usage-outbox', 'pid-test'), { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})
