#Requires -Version 5.1
<#
  Send HTML email via local Outlook (logged-in desktop profile).
  No Azure Mail.Send required.

  -To "a@x.com;b@x.com"
  -Cc "c@x.com"
  -Subject "..."
  -HtmlBodyPath C:\temp\body.html
  -Attachments "C:\a.pdf|C:\b.pdf"
#>
param(
  [Parameter(Mandatory = $true)][string]$To,
  [string]$Cc = '',
  [Parameter(Mandatory = $true)][string]$Subject,
  [Parameter(Mandatory = $true)][string]$HtmlBodyPath,
  [string]$Attachments = '',
  [switch]$AlertOnly
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $HtmlBodyPath)) {
  throw "HtmlBodyPath not found: $HtmlBodyPath"
}
$html = Get-Content -LiteralPath $HtmlBodyPath -Raw -Encoding UTF8

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0) # olMailItem
$mail.To = $To
if ($Cc) { $mail.CC = $Cc }
$mail.Subject = $Subject
$mail.HTMLBody = $html

if ($Attachments) {
  foreach ($p in ($Attachments -split '\|')) {
    $p = $p.Trim()
    if (-not $p) { continue }
    if (-not (Test-Path -LiteralPath $p)) { throw "Attachment missing: $p" }
    [void]$mail.Attachments.Add($p)
  }
}

$mail.Send()
Write-Host "Outlook Send() OK to=$To subject=$Subject"
