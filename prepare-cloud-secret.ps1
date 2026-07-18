# Encode FV session for GitHub Actions secret FV_SESSION_B64
$p = "C:\Cursor\toast-mcp-server\fv-final-session.json"
if (!(Test-Path $p)) {
  Write-Host "Missing $p - login FourVenues via Playwright first"
  exit 1
}
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
Set-Clipboard -Value $b64
Write-Host ""
Write-Host "OK - FV_SESSION_B64 is on your clipboard ($($b64.Length) chars)." -ForegroundColor Green
Write-Host "Paste it as a repository secret named FV_SESSION_B64 here:" -ForegroundColor Cyan
Write-Host "  https://github.com/MLavenant/boh-dashboard/settings/secrets/actions"
Write-Host ""
Write-Host "Also add:"
Write-Host "  TOAST_CLIENT_ID"
Write-Host "  TOAST_API_SECRET"
Write-Host "  RDG_DJ_TOKEN  (GitHub PAT that can push to MLavenant/rdg-dj)"
Write-Host ""
Write-Host "Full guide: C:\Cursor\toast-mcp-server\CLOUD-SETUP.md"
