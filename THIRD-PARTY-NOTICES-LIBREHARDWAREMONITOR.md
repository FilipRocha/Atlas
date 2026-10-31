# Avisos de componentes do coletor de hardware

O pacote do Windows inclui o coletor `LibreHardwareMonitorBridge`. Ele usa `LibreHardwareMonitorLib` e suas dependências transitivas para consultar sensores. Os nomes, versões e licenças abaixo correspondem ao `project.assets.json` do projeto .NET; atualize esta lista quando as dependências mudarem.

| Componente | Versão | Licença indicada | Fonte |
| --- | --- | --- | --- |
| BlackSharp.Core | 1.0.7 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/BlackSharp.Core/1.0.7) |
| DiskInfoToolkit | 1.1.2 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/DiskInfoToolkit/1.1.2) |
| HidSharp | 2.6.4 | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | [NuGet](https://www.nuget.org/packages/HidSharp/2.6.4) |
| LibreHardwareMonitorLib | 0.9.6 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/LibreHardwareMonitorLib/0.9.6) e [projeto](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) |
| Mono.Posix.NETStandard | 1.0.0 | A página NuGet aponta para os termos do projeto Mono | [NuGet](https://www.nuget.org/packages/Mono.Posix.NETStandard/1.0.0) e [termos do Mono](https://github.com/mono/mono/blob/main/LICENSE) |
| RAMSPDToolkit-NDD | 1.4.2 | [MPL-2.0](https://licenses.nuget.org/MPL-2.0) | [NuGet](https://www.nuget.org/packages/RAMSPDToolkit-NDD/1.4.2) |
| .NET Runtime | 8.x | Consulte os avisos distribuídos pela Microsoft | [Termos do .NET](https://dotnet.microsoft.com/en-us/dotnet) |

As bibliotecas MPL-2.0 são componentes de terceiros; o código do Atlas não passa a ser licenciado pela MPL por usá-las. O código do coletor escrito para o Atlas está em `tools/LibreHardwareMonitorBridge` e permanece sob a licença MIT do projeto.

Durante a compilação do coletor, `scripts/build-hardware-bridge.ps1` copia este aviso, a licença incluída no pacote NuGet do HidSharp e os arquivos `LICENSE.txt` e `ThirdPartyNotices.txt` da instalação do .NET para a pasta do coletor. Esses avisos seguem junto com o coletor nos pacotes do Windows.
