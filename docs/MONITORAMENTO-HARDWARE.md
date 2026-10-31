# Monitoramento de hardware

**English:** [Hardware monitoring](HARDWARE-MONITORING.en.md)

A tela **Monitor de Desempenho** e o **Monitor sobreposto** recebem os dados do mesmo serviço do Atlas. Quando uma leitura não está disponível, o aplicativo deixa o valor indisponível em vez de inventá-lo.

## Fontes de dados

| Informação | Fonte principal | Alternativa |
| --- | --- | --- |
| CPU no Windows | Contador de desempenho do Windows para o tempo do processador | Ticks do sistema operacional |
| Uso da GPU | Contadores WDDM do Windows | Sensor do LibreHardwareMonitor |
| Temperaturas, VRAM e sensores do disco | LibreHardwareMonitor | `nvidia-smi` para dados compatíveis com placas NVIDIA; `smartctl` ou leitura S.M.A.R.T. nativa para dados de discos |
| Memória, rede e informações gerais | `systeminformation` e APIs do sistema | Disponibilidade varia por sistema |
| Leitura, gravação e atividade dos discos | Contadores do Windows | Leitura de volumes do sistema |

## CPU: interpretação do valor

No Windows, o Atlas tenta localizar o contador de tempo total do processador pelos nomes localizados do próprio sistema. A amostragem ocorre em intervalos próximos de um segundo. Se esse contador não estiver disponível, o Atlas usa os ticks de CPU fornecidos pelo sistema operacional.

O Gerenciador de Tarefas e o Monitor de Recursos podem aplicar apresentação, janela de atualização e cálculos próprios. Por isso, os números do Atlas podem oscilar ou diferir dos números do Windows, mesmo quando consultam dados do sistema. O valor não representa um relatório oficial do Gerenciador de Tarefas e não há garantia de igualdade exata entre as ferramentas.

O monitor de processos mostra CPU por processo usando deltas de tempo do processo e do sistema. A leitura pode não estar disponível para alguns processos protegidos.

## Temperaturas e LibreHardwareMonitor

No Windows, o executável `LibreHardwareMonitorBridge.exe` coleta temperaturas e outros sensores compatíveis. Para compilar esse componente manualmente, instale o .NET 8 SDK e execute:

```powershell
npm run build:hardware-bridge
```

O `npm run dev` tenta compilar o coletor quando ele não está presente. Os pacotes do Windows incluem o coletor.

Em alguns computadores, a leitura de temperatura depende do driver PawnIO. O Atlas pode informar quando ele estiver ausente. A instalação pode ser feita pelo comando oficial do WinGet:

```powershell
winget install namazso.PawnIO
```

Alguns sensores, especialmente os da CPU, podem exigir que o Atlas seja executado como administrador. A disponibilidade e os nomes dos sensores dependem do hardware, firmware e driver. Se o dado não puder ser lido, a interface informa que está indisponível.

### AMD Ryzen 5 5600X

O coletor pode consultar telemetria de temperatura do AMD SMU em processadores compatíveis. Essa leitura é somente de consulta; não altera tensão, potência, frequência, PBO ou Curve Optimizer. A tabela de telemetria e os sensores disponíveis dependem do modelo e da versão do LibreHardwareMonitor.

## Dados de saúde dos discos

O Atlas combina os dados disponíveis entre sensores do coletor, `smartctl` e consultas S.M.A.R.T. nativas do Windows. Nem todo disco fornece temperatura, horas de uso ou vida útil restante. Quando não há uma leitura confiável, o Atlas mostra o dado como indisponível.

- Vida útil restante e percentual usado são apresentados quando o SSD/NVMe informa esses valores.
- HDDs não recebem um percentual de vida útil estimado pelo Atlas.
- A leitura nativa pode exigir privilégios administrativos.
- Para instalar o `smartctl`, use `winget install smartmontools.smartmontools`; o Atlas detecta o executável quando disponível.

## Limitações e diagnóstico

Os sensores podem estar bloqueados pelo firmware, indisponíveis no driver ou exigir privilégios adicionais. A versão do Windows, o idioma do sistema e os contadores instalados também afetam a disponibilidade de algumas leituras.

Para verificar os contadores e sensores no próprio Windows, execute o script de diagnóstico:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-direct-windows.ps1
```

Arquivos relacionados:

- `src/main/services/perf-monitor.ts`: coleta e distribuição das leituras.
- `src/main/services/disk-smart-native.ts`: consultas nativas S.M.A.R.T.
- `tools/LibreHardwareMonitorBridge/Program.cs`: coletor de sensores.
- `src/renderer/src/pages/PerformanceMonitorPage.tsx`: tela de desempenho.
