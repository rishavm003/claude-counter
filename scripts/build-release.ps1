# Build Release Script for Claude Counter
# Creates distributable ZIP files for Chrome/Edge and Firefox

param(
    [string]$Version = "0.4.2"
)

$ErrorActionPreference = "Stop"
$DistDir = "f:\claude-counter-0.4.2\dist"
$ExtensionDir = "f:\claude-counter-0.4.2\extension"
$RootDir = "f:\claude-counter-0.4.2"

Write-Host "Building Claude Counter v$Version..." -ForegroundColor Cyan
Write-Host ""

# Ensure dist directory exists
if (!(Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
}

# Clean old builds
Get-ChildItem $DistDir -Filter "*.zip" | Remove-Item -Force

Write-Host "1. Creating Chrome/Edge extension ZIP..." -ForegroundColor Yellow
$ChromeZip = "$DistDir\claude-counter-$Version.zip"
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $ChromeZip -Force
Write-Host "   Created: $ChromeZip" -ForegroundColor Green

Write-Host ""
Write-Host "2. Creating Firefox XPI (unsigned)..." -ForegroundColor Yellow
# Firefox XPI is essentially a ZIP with .xpi extension
$FirefoxXpi = "$DistDir\claude-counter-$Version.xpi"
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $FirefoxXpi -Force
Write-Host "   Created: $FirefoxXpi" -ForegroundColor Green
Write-Host "   Note: For Firefox Add-ons store, you need to sign this with Mozilla" -ForegroundColor DarkYellow

Write-Host ""
Write-Host "3. Creating source code ZIP..." -ForegroundColor Yellow
$SourceZip = "$DistDir\claude-counter-$Version-source.zip"
Compress-Archive -Path @(
    "$RootDir\extension",
    "$RootDir\assets",
    "$RootDir\docs",
    "$RootDir\userscript",
    "$RootDir\README.md",
    "$RootDir\PROJECT_STRUCTURE.md",
    "$RootDir\.gitignore"
) -DestinationPath $SourceZip -Force
Write-Host "   Created: $SourceZip" -ForegroundColor Green

Write-Host ""
Write-Host "Build complete! Files in dist/ folder:" -ForegroundColor Cyan
Get-ChildItem $DistDir | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 2)
    Write-Host "  - $($_.Name) (${size} KB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Test the extension by loading dist/ folder in Chrome" -ForegroundColor White
Write-Host "  2. Create a GitHub release and upload these files:" -ForegroundColor White
Write-Host "     https://github.com/rishavm003/claude-counter/releases/new" -ForegroundColor Blue
Write-Host "  3. Or push a tag to trigger automatic release:" -ForegroundColor White
Write-Host "     git tag v$Version" -ForegroundColor DarkGray
Write-Host "     git push origin v$Version" -ForegroundColor DarkGray
