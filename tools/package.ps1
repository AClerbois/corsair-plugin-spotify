# Builds dist/SpotifyPlayer.icuewidget (a zip with the widget files at its root).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'widget'
$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'SpotifyPlayer.icuewidget'
$zip = Join-Path $dist 'SpotifyPlayer.zip'

New-Item -ItemType Directory -Force $dist | Out-Null
Remove-Item $out, $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip
Move-Item $zip $out
Write-Host "Built $out"
