$ErrorActionPreference = 'Stop'
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace('MAPI')
$inbox = $ns.GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort('[ReceivedTime]', $true)

$target = $null
$n = 0
foreach ($m in $items) {
  $n++
  if ($n -gt 300) { break }
  try {
    $subj = [string]$m.Subject
    $from = [string]$m.SenderEmailAddress
    if ($subj -eq 'Sales Report' -and $from -match 'fourvenues') {
      $target = $m
      break
    }
  } catch {}
}
if (-not $target) { throw 'No Sales Report email' }

$body = [string]$target.Body
$html = [string]$target.HTMLBody
$link = $null
if ($body -match '<(https://[^>]+)>') { $link = $Matches[1] }
elseif ($html -match 'href="(https://[^"]+)"') { $link = ($Matches[1] -replace '&amp;', '&') }
Write-Output ("LINK=" + $link)

$outDir = 'C:\Cursor\toast-mcp-server\fv-exports'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'email-test.xlsx'

$s3 = $null
if ($link -match 'url=([^&]+)') {
  $s3 = [uri]::UnescapeDataString($Matches[1])
}
Write-Output ("S3=" + $s3)

$uri = if ($s3) { $s3 } else { $link }
Invoke-WebRequest -Uri $uri -OutFile $out -UseBasicParsing
Write-Output ("saved=" + $out + " size=" + (Get-Item $out).Length)
Write-Output ("received=" + $target.ReceivedTime.ToString('o'))
