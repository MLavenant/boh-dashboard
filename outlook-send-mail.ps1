#Requires -Version 5.1
<#
  Send HTML email via local Outlook (logged-in desktop profile).
  Matches Forecast "Send all emails" MIME shape: HTML with cid: images +
  true inline JPEG attachments (Content-ID) + PDF file attachments.

  -To "a@x.com;b@x.com"
  -Cc "c@x.com"
  -Subject "..."
  -HtmlBodyPath C:\temp\body.html
  -Inlines "C:\a.jpg|snap0@rdg;C:\b.jpg|snap1@rdg"
  -Attachments "C:\a.pdf|C:\b.pdf"
#>
param(
  [Parameter(Mandatory = $true)][string]$To,
  [string]$Cc = '',
  [Parameter(Mandatory = $true)][string]$Subject,
  [Parameter(Mandatory = $true)][string]$HtmlBodyPath,
  [string]$Inlines = '',
  [string]$Attachments = '',
  [switch]$AlertOnly
)

$ErrorActionPreference = 'Stop'

# PR_ATTACH_CONTENT_ID / PR_ATTACHMENT_HIDDEN
$PR_ATTACH_CONTENT_ID = 'http://schemas.microsoft.com/mapi/proptag/0x3712001F'
$PR_ATTACHMENT_HIDDEN = 'http://schemas.microsoft.com/mapi/proptag/0x7FFE000B'

if (-not (Test-Path -LiteralPath $HtmlBodyPath)) {
  throw "HtmlBodyPath not found: $HtmlBodyPath"
}
$html = Get-Content -LiteralPath $HtmlBodyPath -Raw -Encoding UTF8

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0) # olMailItem
$mail.To = $To
if ($Cc) { $mail.CC = $Cc }
$mail.Subject = $Subject
$mail.BodyFormat = 2 # olFormatHTML
$mail.HTMLBody = $html

# Inline CID images first (same as Send-all .eml multipart/related)
if ($Inlines) {
  foreach ($pair in ($Inlines -split ';')) {
    $pair = $pair.Trim()
    if (-not $pair) { continue }
    $parts = $pair -split '\|', 2
    if ($parts.Count -lt 2) { throw "Inline entry must be path|cid: $pair" }
    $imgPath = $parts[0].Trim()
    $cid = $parts[1].Trim().Trim('<', '>')
    if (-not (Test-Path -LiteralPath $imgPath)) { throw "Inline image missing: $imgPath" }
    $att = $mail.Attachments.Add($imgPath)
    $att.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, $cid)
    try { $att.PropertyAccessor.SetProperty($PR_ATTACHMENT_HIDDEN, $true) } catch { }
  }
}

if ($Attachments) {
  foreach ($p in ($Attachments -split '\|')) {
    $p = $p.Trim()
    if (-not $p) { continue }
    if (-not (Test-Path -LiteralPath $p)) { throw "Attachment missing: $p" }
    [void]$mail.Attachments.Add($p)
  }
}

$mail.Send()
Write-Host "Outlook Send() OK to=$To subject=$Subject inlines=$([bool]$Inlines)"
