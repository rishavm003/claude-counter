# Release checks: one version everywhere, required files present.
# Usage: ./scripts/check-release.ps1 [-Version 1.2.3]

param(
    [string]$Version = (Get-Content -Raw "$PSScriptRoot/../manifest.json" | ConvertFrom-Json).version
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version '$Version' is not MAJOR.MINOR.PATCH." }

$manifest = Get-Content -Raw (Join-Path $RootDir "manifest.json") | ConvertFrom-Json
$package  = Get-Content -Raw (Join-Path $RootDir "package.json") | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw "manifest.json is $($manifest.version), expected $Version." }
if ($package.version  -ne $Version) { throw "package.json is $($package.version), expected $Version." }
if ($manifest.manifest_version -ne 3) { throw "Chrome/Edge/Brave need a Manifest V3 extension." }

foreach ($size in 16, 32, 48, 96, 128, 256) {
    if (!(Test-Path (Join-Path $RootDir "icons/icon-$size.png"))) { throw "Missing icons/icon-$size.png" }
}
foreach ($doc in "README.md", "CHANGELOG.md") {
    if ((Get-Content -Raw (Join-Path $RootDir $doc)) -notmatch [regex]::Escape($Version)) { throw "$doc does not mention $Version." }
}

Write-Host "Release checks passed for v$Version." -ForegroundColor Green
