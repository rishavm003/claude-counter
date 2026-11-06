# Builds dist/claude-counter-<version>.zip, installable in Chrome, Microsoft Edge and Brave.
# Usage: ./scripts/build.ps1            (version read from manifest.json)

param(
    [string]$Version = (Get-Content -Raw "$PSScriptRoot/../manifest.json" | ConvertFrom-Json).version
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$DistDir = Join-Path $RootDir "dist"

& (Join-Path $PSScriptRoot "check-release.ps1") -Version $Version

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
Get-ChildItem $DistDir -Filter "*.zip" | Remove-Item -Force

$Zip = Join-Path $DistDir "claude-counter-$Version.zip"
# Only what the browser needs: manifest, code, icons
Compress-Archive -Path (Join-Path $RootDir "manifest.json"), (Join-Path $RootDir "src"), (Join-Path $RootDir "icons") -DestinationPath $Zip -Force
$size = [math]::Round((Get-Item $Zip).Length / 1KB, 1)
Write-Host "Built $Zip ($size KB)" -ForegroundColor Green
