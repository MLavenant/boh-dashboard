# Encode FV session for GitHub Actions secret FV_SESSION_B64
# Uses a slimmed session (cookies + auth only) so it fits GitHub's ~64KB secret limit.
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Cursor\toast-mcp-server'
node prepare-fv-session-slim.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
