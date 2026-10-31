$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'tools\LibreHardwareMonitorBridge\LibreHardwareMonitorBridge.csproj'
$out = Join-Path $root 'resources\hardware-bridge'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw 'O .NET SDK não foi encontrado. Instale o .NET 8 SDK para compilar o coletor de hardware do Atlas.'
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
Remove-Item (Join-Path $out '*') -Recurse -Force -ErrorAction SilentlyContinue

dotnet restore $project
dotnet publish $project -c Release -r win-x64 --self-contained true -o $out

$exe = Join-Path $out 'LibreHardwareMonitorBridge.exe'
if (-not (Test-Path $exe)) {
  throw "A compilação terminou sem gerar o executável esperado: $exe"
}

# Keep notices beside the redistributed collector rather than only in the source tree.
$notice = Join-Path $root 'THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md'
if (-not (Test-Path $notice)) {
  throw "Avisos de terceiros não encontrados: $notice"
}
Copy-Item -LiteralPath $notice -Destination (Join-Path $out 'THIRD-PARTY-NOTICES.md') -Force

# Include the exact HidSharp license and the notices supplied by the bundled .NET runtime.
$assetsPath = Join-Path $root 'tools\LibreHardwareMonitorBridge\obj\project.assets.json'
$assets = Get-Content $assetsPath -Raw | ConvertFrom-Json
$hidSharpLibrary = $assets.libraries.PSObject.Properties.Name |
  Where-Object { $_ -match '^HidSharp/(?<version>[^/]+)$' } |
  Select-Object -First 1
if (-not $hidSharpLibrary) {
  throw 'HidSharp não foi encontrado nas dependências restauradas do coletor.'
}
$hidSharpVersion = ($hidSharpLibrary -split '/', 2)[1]
$hidSharpLicense = Join-Path (Join-Path (Join-Path $env:USERPROFILE '.nuget\packages\hidsharp') $hidSharpVersion) 'LICENSE.txt'
if (-not (Test-Path $hidSharpLicense)) {
  throw "Licença do HidSharp não encontrada: $hidSharpLicense"
}
Copy-Item -LiteralPath $hidSharpLicense -Destination (Join-Path $out 'HidSharp-LICENSE.txt') -Force

$dotnetExecutable = (Get-Command dotnet -ErrorAction Stop).Source
$dotnetRoot = Split-Path -Parent $dotnetExecutable
foreach ($fileName in @('LICENSE.txt', 'ThirdPartyNotices.txt')) {
  $runtimeNotice = Join-Path $dotnetRoot $fileName
  if (-not (Test-Path $runtimeNotice)) {
    throw "Aviso legal do .NET não encontrado: $runtimeNotice"
  }
  $destinationName = if ($fileName -eq 'LICENSE.txt') { 'dotnet-LICENSE.txt' } else { 'dotnet-ThirdPartyNotices.txt' }
  Copy-Item -LiteralPath $runtimeNotice -Destination (Join-Path $out $destinationName) -Force
}

Write-Host "Coletor de hardware compilado em: $out"
