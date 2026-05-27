$root = Split-Path $PSScriptRoot -Parent
$ext = Join-Path $root "extension"
$files = Get-ChildItem $ext -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum

Write-Host ""
Write-Host "Extension folder: $ext" -ForegroundColor Cyan
Write-Host ("TOTAL: {0} files  |  {1:N1} KB  |  {2:N3} MB" -f $files.Count, ($total/1KB), ($total/1MB)) -ForegroundColor Yellow
Write-Host ""
Write-Host "--- Files by size (largest first) ---" -ForegroundColor Cyan

$files | Sort-Object Length -Descending | ForEach-Object {
    $rel = $_.FullName.Replace($ext + "\", "")
    $kb  = [math]::Round($_.Length / 1KB, 1)
    Write-Host ("{0,9:N1} KB  {1}" -f $kb, $rel)
}

Write-Host ""
Write-Host "--- Per-directory totals ---" -ForegroundColor Cyan
$files | Group-Object { $_.DirectoryName.Replace($ext + "\", "") } |
    Sort-Object { ($_.Group | Measure-Object Length -Sum).Sum } -Descending |
    ForEach-Object {
        $dirSize = ($_.Group | Measure-Object Length -Sum).Sum
        Write-Host ("{0,9:N1} KB  {1}" -f ($dirSize/1KB), $_.Name)
    }
