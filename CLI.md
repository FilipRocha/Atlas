# Linha de comando

**English:** [Command-line guide](CLI.en.md)

O Atlas pode executar tarefas pelo terminal sem abrir a janela. A disponibilidade dos comandos varia conforme o sistema operacional; algumas ações do Windows exigem privilégios de administrador.

```text
atlas --cli <comando> [subcomando] [opções]
```

Para consultar a ajuda da versão instalada:

```powershell
atlas --cli --help
```

## Limpeza de arquivos

Faça uma análise primeiro. Ela não apaga arquivos:

```powershell
atlas --cli scan --all
atlas --cli scan --system --browser
```

Para apagar os itens encontrados, use `clean` ou acrescente `--clean` à análise:

```powershell
atlas --cli clean --system --clean
atlas --cli clean --all --clean --json
```

As categorias são `--system`, `--browser`, `--app`, `--gaming`, `--recycle-bin` e `--all`. Revise os resultados antes de usar opções que apagam dados.

## Comandos

| Comando | Ação |
| --- | --- |
| `registry scan` / `registry fix [--all]` | Analisa ou corrige problemas encontrados no Registro. |
| `startup list` / `startup boot-trace` | Lista itens de inicialização ou consulta o tempo de inicialização. |
| `startup enable <nome>` / `startup disable <nome>` / `startup delete <nome>` | Altera ou remove um item de inicialização. |
| `debloat scan` / `debloat remove <pacote,...>` / `debloat remove --all` | Lista ou remove pacotes pré-instalados selecionados. |
| `disk drives` / `disk analyze <unidade>` / `disk file-types <unidade>` | Lista unidades ou analisa o espaço ocupado. |
| `network scan` / `network clean [--all]` | Analisa ou limpa itens de rede disponíveis. |
| `malware scan` / `malware quarantine <caminho>` / `malware delete <caminho>` | Verifica, coloca em quarentena ou apaga um arquivo. |
| `privacy scan` / `privacy apply [--all]` | Consulta ou aplica opções de privacidade. |
| `drivers scan` / `drivers check-updates` / `drivers clean <nome,...>` | Analisa drivers, consulta atualizações ou remove pacotes selecionados. |
| `drivers update [--all]` / `drivers ignore <id,...>` / `drivers unignore <id,...>` | Instala atualizações ou altera a lista de atualizações ignoradas. |
| `services scan` / `services disable <nome>` / `services manual <nome>` | Consulta ou altera serviços do Windows. |
| `programs list` | Lista programas instalados. |
| `updates check` / `updates run <id,...>` / `updates run --all` | Consulta ou instala atualizações de programas via WinGet. |
| `perf info` / `perf disk-health` / `perf kill <pid>` | Consulta o sistema, a saúde dos discos ou encerra um processo. |
| `leftovers scan` / `leftovers clean --path <caminho> [...]` | Localiza resíduos e limpa apenas caminhos explicitamente revisados. |
| `history list` / `history clear` | Consulta ou apaga o histórico de análises. |
| `restore-point create [descrição]` | Cria um ponto de restauração do Windows. |
| `repair gpu-restart` / `repair winre-status [--verbose]` | Reinicia adaptadores de vídeo ou consulta o WinRE no Windows. |
| `config get [chave]` | Consulta configurações; chaves secretas são ocultadas. |
| `service uninstall` / `service status` | Remove ou consulta o serviço do Atlas no Linux. |
| `metrics` / `metrics-server [--port <número>]` | Exibe métricas Prometheus ou inicia o servidor HTTP. |

O servidor de métricas usa a porta `9100` por padrão e disponibiliza `/metrics` e `/health`.

## Opções gerais

| Opção | Função |
| --- | --- |
| `--json` | Retorna os dados em JSON; o progresso vai para `stderr`. |
| `--verbose` | Exibe progresso e detalhes de diagnóstico. |
| `--quiet` ou `-q` | Suprime a saída normal. Mensagens de uso inválido e itens não encontrados continuam visíveis; com `--json`, os dados ainda são emitidos. |
| `--all` | Seleciona todos os itens nos comandos que aceitam essa opção. |
| `--include-cache-resets` | Inclui redefinições de cache em operações de limpeza compatíveis. A próxima abertura do programa pode ser mais lenta. |
| `--include-maintenance` | Inclui manutenção nativa opcional em operações de limpeza compatíveis. A economia não é estimada. |
| `--help` ou `-h` | Exibe a ajuda. |
| `--version` ou `-v` | Exibe a versão. |

`--verbose` e `--quiet` não devem ser usados juntos.

## Exemplos

```powershell
atlas --cli registry scan --json
atlas --cli startup boot-trace
atlas --cli perf disk-health
atlas --cli leftovers scan --json
atlas --cli metrics-server --port 9200
```

### Limpar resíduos de programas

Faça uma análise e revise os caminhos retornados:

```powershell
atlas --cli leftovers scan --json
```

Depois indique explicitamente cada caminho que deseja limpar:

```powershell
atlas --cli leftovers clean --path "C:\Users\Nome\AppData\Local\Programa\Cache" --json
```

O comando rejeita caminhos que não estejam na análise recente. Ele não oferece limpeza geral por `--all` ou curingas.

## Códigos de saída

| Código | Significado |
| --- | --- |
| `0` | Sucesso. |
| `1` | Erro geral. |
| `2` | Argumentos inválidos ou uso incorreto. |
| `3` | Permissão insuficiente ou elevação necessária. |
| `4` | Sucesso parcial; uma parte da operação falhou. |
| `5` | Nenhum item encontrado em operações que usam esse resultado, como uma limpeza sem itens ou um item de inicialização inexistente. |
| `6` | Comando desconhecido. |
| `7` | A verificação de malware encontrou ameaças. |
