# Hardware monitoring

**Português:** [Monitoramento de hardware](MONITORAMENTO-HARDWARE.md)

The **Performance Monitor** page and the **Overlay Monitor** receive data from the same Atlas service. When a reading is unavailable, the app marks it unavailable instead of inventing a value.

## Data sources

| Information | Primary source | Fallback |
| --- | --- | --- |
| CPU on Windows | Windows performance counter for processor time | Operating system ticks |
| GPU usage | Windows WDDM counters | LibreHardwareMonitor sensor |
| Temperatures, VRAM, and disk sensors | LibreHardwareMonitor | `nvidia-smi` for compatible NVIDIA cards; `smartctl` or native S.M.A.R.T. reads for disks |
| Memory, network, and general information | `systeminformation` and system APIs | Availability varies by system |
| Disk reads, writes, and activity | Windows counters | System volume reads |

## Understanding CPU readings

On Windows, Atlas tries to find the total processor time counter using the localized names provided by the operating system. Sampling occurs at intervals close to one second. If that counter is unavailable, Atlas uses CPU ticks provided by the operating system.

Task Manager and Resource Monitor may use their own display, refresh interval, and calculations. Atlas readings can therefore fluctuate or differ from Windows readings even when they query system data. The value is not an official Task Manager report, and exact agreement between tools is not guaranteed.

The process monitor reports per-process CPU usage using deltas from process and system time. Readings may be unavailable for some protected processes.

## Temperatures and LibreHardwareMonitor

On Windows, `LibreHardwareMonitorBridge.exe` collects temperatures and other supported sensors. To build this component manually, install the .NET 8 SDK and run:

```powershell
npm run build:hardware-bridge
```

`npm run dev` attempts to build the collector if it is missing. Windows packages include the collector.

On some computers, temperature readings depend on the PawnIO driver. Atlas may report when it is missing. Install it with the official WinGet command:

```powershell
winget install namazso.PawnIO
```

Some sensors, especially CPU sensors, may require running Atlas as administrator. Sensor availability and names depend on the hardware, firmware, and driver. If a reading cannot be retrieved, the interface marks it unavailable.

### AMD Ryzen 5 5600X

The collector can read AMD SMU temperature telemetry on compatible processors. This is read-only and does not change voltage, power, frequency, PBO, or Curve Optimizer. Available telemetry and sensors depend on the model and LibreHardwareMonitor version.

## Disk health data

Atlas combines available data from collector sensors, `smartctl`, and native Windows S.M.A.R.T. queries. Not every disk reports temperature, operating hours, or remaining life. When no reliable reading is available, Atlas marks the value unavailable.

- Remaining life and percentage used are shown when the SSD/NVMe reports them.
- Atlas does not estimate a remaining-life percentage for HDDs.
- Native reads may require administrator privileges.
- To install `smartctl`, run `winget install smartmontools.smartmontools`; Atlas detects the executable when available.

## Limitations and diagnostics

Firmware may block sensors, a driver may not expose them, or additional privileges may be required. Windows version, system language, and installed counters can also affect reading availability.

To check counters and sensors on Windows, run the diagnostic script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-direct-windows.ps1
```

Related files:

- `src/main/services/perf-monitor.ts`: collects and distributes readings.
- `src/main/services/disk-smart-native.ts`: native S.M.A.R.T. queries.
- `tools/LibreHardwareMonitorBridge/Program.cs`: sensor collector.
- `src/renderer/src/pages/PerformanceMonitorPage.tsx`: performance page.
