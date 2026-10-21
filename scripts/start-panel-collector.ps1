$ErrorActionPreference = 'Stop'
$collectorRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$collectorPath = Join-Path $collectorRoot 'scripts\panel-collector.ts'
$collectorLogDir = Join-Path $collectorRoot 'logs'
$runningCollector = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($collectorPath) }
if ($runningCollector) { Write-Output 'Coletor gerencial já está ativo.'; exit 0 }
New-Item -ItemType Directory -Path $collectorLogDir -Force | Out-Null
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$collectorProcess = Start-Process -FilePath $nodePath -ArgumentList @('--experimental-strip-types', ('"' + $collectorPath + '"')) -WorkingDirectory $collectorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $collectorLogDir 'panel-collector.out.log') -RedirectStandardError (Join-Path $collectorLogDir 'panel-collector.err.log') -PassThru
Write-Output ('Coletor gerencial iniciado. PID ' + $collectorProcess.Id)
