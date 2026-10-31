$ErrorActionPreference = 'SilentlyContinue'

Write-Host '--- CPU Processor Utility ---'
$c = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation |
    Where-Object { $_.Name -eq '_Total' } |
    Select-Object -First 1

if ($c) {
    Write-Host ('Processor Utility : ' + [math]::Round([double]$c.PercentProcessorUtility, 1) + ' %')
    Write-Host ('Processor Time    : ' + [math]::Round([double]$c.PercentProcessorTime, 1) + ' %')
} else {
    Write-Host 'CPU provider indisponivel'
}

Write-Host ''
Write-Host '--- GPU WDDM ---'
try {
    $samples = @(Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 0.5 -MaxSamples 1 -ErrorAction Stop |
        Select-Object -ExpandProperty CounterSamples)

    $gpu3d = $null
    $gpuMax = $null

    foreach ($sample in $samples) {
        $value = [double]$sample.CookedValue
        if ($value -lt 0 -or $value -gt 100) { continue }

        if ([string]$sample.InstanceName -match '(?i)eng_3D|engtype_3D') {
            if ($null -eq $gpu3d -or $value -gt $gpu3d) { $gpu3d = $value }
        }

        if ($null -eq $gpuMax -or $value -gt $gpuMax) { $gpuMax = $value }
    }

    if ($null -ne $gpu3d) {
        Write-Host ('GPU 3D           : ' + [math]::Round($gpu3d, 1) + ' %')
    } elseif ($null -ne $gpuMax) {
        Write-Host ('GPU max engine   : ' + [math]::Round($gpuMax, 1) + ' %')
    } else {
        Write-Host 'GPU sem atividade'
    }
} catch {
    Write-Host ('GPU WDDM indisponivel: ' + $_.Exception.Message)
}

Write-Host ''
Write-Host '--- GPU adapter ---'
Get-CimInstance Win32_VideoController |
    Where-Object { $_.Name } |
    Select-Object Name, AdapterRAM, PNPDeviceID |
    Format-List
