# Third-party notices for the hardware collector

**Português:** [Avisos de componentes do coletor de hardware](THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md)

The Windows package includes the `LibreHardwareMonitorBridge` collector. It uses `LibreHardwareMonitorLib` and its transitive dependencies to query sensors. The names, versions, and licenses below match the .NET project's `project.assets.json`; update this list when dependencies change.

| Component | Version | Stated license | Source |
| --- | --- | --- | --- |
| BlackSharp.Core | 1.0.7 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/BlackSharp.Core/1.0.7) |
| DiskInfoToolkit | 1.1.2 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/DiskInfoToolkit/1.1.2) |
| HidSharp | 2.6.4 | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | [NuGet](https://www.nuget.org/packages/HidSharp/2.6.4) |
| LibreHardwareMonitorLib | 0.9.6 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/LibreHardwareMonitorLib/0.9.6) and [project](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) |
| Mono.Posix.NETStandard | 1.0.0 | The NuGet page points to the Mono project terms | [NuGet](https://www.nuget.org/packages/Mono.Posix.NETStandard/1.0.0) and [Mono terms](https://github.com/mono/mono/blob/main/LICENSE) |
| RAMSPDToolkit-NDD | 1.4.2 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/RAMSPDToolkit-NDD/1.4.2) |
| .NET Runtime | 8.x | See the notices distributed by Microsoft | [.NET terms](https://dotnet.microsoft.com/en-us/dotnet) |

MPL-2.0 libraries are third-party components; using them does not relicense Atlas code under MPL. The collector code written for Atlas is in `tools/LibreHardwareMonitorBridge` and remains under the project's MIT license.

When building the collector, `scripts/build-hardware-bridge.ps1` copies this notice, the license included in the HidSharp NuGet package, and the .NET installation's `LICENSE.txt` and `ThirdPartyNotices.txt` files into the collector folder. These notices are included with the collector in Windows packages.
