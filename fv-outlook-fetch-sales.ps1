param(
  [Parameter(Mandatory = $true)][string]$AfterIso,
  [Parameter(Mandatory = $false)][string]$VenueId = '',
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $false)][int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$after = [datetime]::Parse($AfterIso, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
# Outlook ReceivedTime is local; compare in local
if ($after.Kind -eq [DateTimeKind]::Utc) { $after = $after.ToLocalTime() }

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$chosen = $null
$chosenLink = $null

function Get-SalesLink($mail) {
  $body = [string]$mail.Body
  $html = [string]$mail.HTMLBody
  $link = $null
  if ($body -match '<(https://[^>]+)>') { $link = $Matches[1] }
  elseif ($html -match 'href="(https://[^"]+)"') { $link = ($Matches[1] -replace '&amp;', '&') }
  return $link
}

function Get-S3Url($link) {
  if (-not $link) { return $null }
  if ($link -match 'url=([^&]+)') {
    return [uri]::UnescapeDataString($Matches[1])
  }
  return $link
}

while ((Get-Date) -lt $deadline) {
  $outlook = New-Object -ComObject Outlook.Application
  $ns = $outlook.GetNamespace('MAPI')
  $inbox = $ns.GetDefaultFolder(6)
  $items = $inbox.Items
  $items.Sort('[ReceivedTime]', $true)

  $n = 0
  foreach ($m in $items) {
    $n++
    if ($n -gt 80) { break }
    try {
      $subj = [string]$m.Subject
      $from = [string]$m.SenderEmailAddress
      if ($subj -ne 'Sales Report') { continue }
      if ($from -notmatch 'fourvenues') { continue }
      $recv = [datetime]$m.ReceivedTime
      if ($recv -lt $after.AddSeconds(-5)) { continue }

      $link = Get-SalesLink $m
      $s3 = Get-S3Url $link
      if (-not $s3) { continue }

      if ($VenueId -and ($s3 -notmatch [regex]::Escape($VenueId))) { continue }

      $chosen = $m
      $chosenLink = $s3
      break
    } catch {}
  }

  # Release COM promptly
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($items)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($inbox)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ns)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
  [GC]::Collect()

  if ($chosenLink) { break }

  # Halfway: retry without venue filter (still after $after)
  if (-not $chosenLink -and $VenueId -and ((Get-Date) -gt $after.AddSeconds($TimeoutSec / 2))) {
    $VenueId = ''
  }
  Start-Sleep -Seconds 5
}

if (-not $chosenLink) {
  Write-Output (@{ ok = $false; error = 'No matching Sales Report email within timeout' } | ConvertTo-Json -Compress)
  exit 2
}

$dir = Split-Path -Parent $OutFile
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -Uri $chosenLink -OutFile $OutFile -UseBasicParsing

$result = @{
  ok         = $true
  outFile    = $OutFile
  size       = (Get-Item $OutFile).Length
  received   = ([datetime]$chosen.ReceivedTime).ToString('o')
  s3         = $chosenLink
  venueMatch = [bool]$VenueId
}
Write-Output ($result | ConvertTo-Json -Compress)
