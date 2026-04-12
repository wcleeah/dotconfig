import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const FIXTURES_DIR = join(import.meta.dir, "fixtures")

/**
 * Creates a temporary copy of a committed SQLite fixture.
 *
 * Tests can mutate the copy freely without modifying the committed fixture.
 *
 * @param {string} name
 * @returns {{ root: string, dbPath: string, cleanup: () => void }}
 */
export function copyFixtureDb(name) {
  const root = mkdtempSync(join(tmpdir(), "usage-tracker-fixture-"))
  const dbPath = join(root, "opencode.db")
  copyFileSync(join(FIXTURES_DIR, name), dbPath)

  return {
    root,
    dbPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
