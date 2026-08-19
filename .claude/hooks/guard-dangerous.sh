#!/usr/bin/env bash
# PreToolUse guard for Bash commands (see execution plan §2.3, Anexo C).
# Warns and asks for confirmation on destructive-ish commands; never blocks
# outright (principle 5: "advertir sin bloquear" applies to the process too).
set -euo pipefail

input="$(cat)"

command="$(node -e '
let data = "";
process.stdin.on("data", (d) => (data += d));
process.stdin.on("end", () => {
  try {
    const json = JSON.parse(data);
    process.stdout.write(json.tool_input && json.tool_input.command ? json.tool_input.command : "");
  } catch (_e) {
    process.stdout.write("");
  }
});
' <<<"$input")"

if [ -z "$command" ]; then
  exit 0
fi

reason=""

if echo "$command" | grep -Eq 'prisma[[:space:]]+migrate[[:space:]]+reset'; then
  reason="This runs 'prisma migrate reset', which drops and recreates the database. Confirm this targets local Docker Postgres, never yacco_prod or yacco_demo."
elif echo "$command" | grep -Eq 'git[[:space:]]+push[[:space:]]+(--force|-f)([[:space:]]|$)|--force-with-lease'; then
  reason="This force-pushes, which can overwrite history on the remote. Confirm this is intentional."
elif echo "$command" | grep -Eq '(^|[[:space:]])rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r'; then
  reason="This recursively force-deletes files ('rm -rf'). Confirm the path is inside the repo and is really meant to be deleted."
elif echo "$command" | grep -Eq '>[[:space:]]*\.env([^a-zA-Z0-9._-]|$)|>>[[:space:]]*\.env([^a-zA-Z0-9._-]|$)|(cp|mv)[[:space:]].*[[:space:]]\.env([^a-zA-Z0-9._-]|$)'; then
  reason="This writes to a .env file, which holds real secrets and must never be read or written by the agent. Confirm this is intentional and not committed."
fi

if [ -n "$reason" ]; then
  node -e '
const reason = process.argv[1];
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: reason,
  },
}));
' "$reason"
fi

exit 0
