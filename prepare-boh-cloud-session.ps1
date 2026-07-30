#Requires -Version 5.1
<#
  Compress and Base64-encode toast-session.json for the GitHub Actions secret
  TOAST_SESSION_GZIP_B64.

  The value is copied to the clipboard. It is never printed or committed.
  Run after a successful local: node intercept.js
#>
param(
  [string]$SessionFile = 'C:\Cursor\toast-mcp-server\toast-session.json'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $SessionFile)) {
  throw "Missing $SessionFile. Run node intercept.js first."
}

$json = Get-Content $SessionFile -Raw
$parsed = $json | ConvertFrom-Json
if (-not $parsed.cookies -or $parsed.cookies.Count -eq 0) {
  throw 'Toast session contains no cookies.'
}

$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$output = [IO.MemoryStream]::new()
$gzip = [IO.Compression.GzipStream]::new(
  $output,
  [IO.Compression.CompressionMode]::Compress,
  $true
)
$gzip.Write($bytes, 0, $bytes.Length)
$gzip.Dispose()
$encoded = [Convert]::ToBase64String($output.ToArray())
$output.Dispose()

if ($encoded.Length -gt 48000) {
  throw "Compressed secret is $($encoded.Length) characters; GitHub limit is 48,000."
}

Set-Clipboard -Value $encoded
Write-Host "Copied TOAST_SESSION_GZIP_B64 to clipboard."
Write-Host "Cookies: $($parsed.cookies.Count) | Secret characters: $($encoded.Length)"
Write-Host "Add it at:"
Write-Host "https://github.com/MLavenant/boh-dashboard/settings/secrets/actions/new"

