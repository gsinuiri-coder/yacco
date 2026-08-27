#!/usr/bin/env bash
# PostToolUse formatter for Edit/Write. $CLAUDE_FILE_PATHS arrives empty in
# this environment, so the previous hook (`prettier --write $CLAUDE_FILE_PATHS`)
# silently formatted nothing. This reads tool_input.file_path from the hook's
# own JSON on stdin instead — same node -e pattern guard-dangerous.sh already
# uses to read tool_input.command.
set -euo pipefail

input="$(cat)"

file_path="$(node -e '
let data = "";
process.stdin.on("data", (d) => (data += d));
process.stdin.on("end", () => {
  try {
    const json = JSON.parse(data);
    process.stdout.write(json.tool_input && json.tool_input.file_path ? json.tool_input.file_path : "");
  } catch (_e) {
    process.stdout.write("");
  }
});
' <<<"$input")"

if [ -z "$file_path" ]; then
  exit 0
fi

# Not set when the script runs outside a Claude Code hook invocation (e.g.
# manual testing); "." is the repo root in that case, same as cwd already is.
cd "${CLAUDE_PROJECT_DIR:-.}"

# Mirrors package.json's "lint-staged" — the source of truth for which
# extensions get which tool. Keep the two in sync by hand; there is no way to
# have a bash hook read lint-staged's config directly.
case "$file_path" in
  *.ts | *.tsx | *.js | *.jsx | *.cjs | *.mjs)
    pnpm exec prettier --write "$file_path"
    pnpm exec eslint --fix "$file_path"
    ;;
  *.json | *.md | *.yml | *.yaml)
    pnpm exec prettier --write "$file_path"
    ;;
  *)
    exit 0
    ;;
esac
