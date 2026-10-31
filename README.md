# Atlas

**Language / Idioma:** [Português](#portugues) | [English](#english)

<a id="portugues"></a>

## Português

O Atlas reúne ferramentas para cuidar do computador em um só lugar. Ele ajuda a limpar arquivos, organizar programas, acompanhar o desempenho e executar tarefas de manutenção do Windows.

## O que você encontra

As páginas ficam organizadas por tarefa:

- **Início:** resumo do computador e atalhos para as funções principais.
- **Limpeza:** análise de arquivos temporários, cache e outros itens selecionados para remoção.
- **Desempenho:** uso do processador, memória, placa de vídeo, discos, rede, temperaturas e processos.
- **Segurança:** verificações de malware, privacidade e firewall.
- **Programas:** instalação, atualização, desinstalação e gerenciamento de softwares e drivers.
- **Arquivos e discos:** análise do armazenamento, busca por arquivos grandes ou duplicados e manutenção dos discos.
- **Reparo:** ferramentas de diagnóstico e reparo do Windows.
- **Histórico e configurações:** consulta das atividades e personalização do Atlas.

As funções disponíveis variam conforme o sistema operacional, o hardware e as permissões do computador. Algumas ações do Windows pedem confirmação ou autorização do administrador.

## Requisitos para desenvolvimento

- Node.js 22 ou mais recente e npm.
- Windows, macOS ou Linux para executar o projeto. Algumas ferramentas são específicas do Windows.
- No Windows, .NET 8 SDK para compilar o coletor de sensores. O Visual Studio Build Tools com C++ é necessário para compilar o monitor nativo de processos.

## Começar

Na pasta do projeto, instale as dependências e inicie o aplicativo:

```powershell
npm ci
npm run dev
```

No Windows, o início do modo de desenvolvimento tenta preparar os componentes nativos. Se o .NET 8 SDK ou as ferramentas de C++ estiverem ausentes, alguns dados de sensores ou processos podem ficar indisponíveis; o restante do aplicativo pode continuar funcionando com as alternativas disponíveis.

## Verificações e builds

```powershell
npm run check       # verificações de tipos, estilo, regras e testes
npm run qa:smoke    # verificações automatizadas com relatório
npm run build       # compila a aplicação
```

Para criar os pacotes de distribuição:

```powershell
npm run package:win
npm run package:mac
npm run package:linux
```

Os arquivos gerados ficam em `dist/`. O pacote do Windows inclui o coletor de sensores e o monitor nativo de processos.

## Documentação

- [Compilação e distribuição](docs/BUILD.md) · [English](docs/BUILD.en.md)
- [Monitoramento de hardware](docs/MONITORAMENTO-HARDWARE.md) · [English](docs/HARDWARE-MONITORING.en.md)
- [Testes e relatórios de QA](docs/TESTES.md) · [English](docs/TESTING.en.md)
- [Uso pela linha de comando](CLI.md) · [English](CLI.en.md)
- [Segurança](SECURITY.md) · [English](SECURITY.en.md)
- [Regras de limpeza](rules/RULES.md) · [English](rules/RULES.en.md)
- [Catálogo de regras](rules/CATALOG.md) · [English](rules/CATALOG.en.md)
- [Avisos de componentes de terceiros](THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md) · [English](THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.en.md)

## Estrutura do projeto

```text
src/       Código do aplicativo, interface e serviços
docs/      Guias de desenvolvimento e uso
rules/     Regras de análise e limpeza
scripts/   Ferramentas de build, validação e QA
resources/ Recursos incluídos nos pacotes
native/    Componentes nativos do Windows
tools/     Código-fonte do coletor de sensores
```

## Uso responsável

Revise os itens antes de removê-los e leia as confirmações exibidas pelo Atlas. Alterações no Registro, serviços, firewall, drivers e arquivos do sistema podem afetar o Windows. Faça cópias de segurança quando apropriado.

## English

Atlas brings together tools to maintain your computer. It helps clean files, organize programs, monitor performance, and carry out Windows maintenance tasks.

### What you can do

The app organizes its pages by task:

- **Home:** computer overview and shortcuts to key features.
- **Cleaning:** review temporary files, caches, and other selected items before removal.
- **Performance:** monitor CPU, memory, graphics, disks, network, temperatures, and processes.
- **Security:** malware, privacy, and firewall checks.
- **Programs:** install, update, uninstall, and manage software and drivers.
- **Files and disks:** inspect storage, find large or duplicate files, and maintain disks.
- **Repair:** Windows diagnosis and repair tools.
- **History and settings:** review activity and customize Atlas.

Available features depend on the operating system, hardware, and permissions. Some Windows actions require confirmation or administrator approval.

### Development requirements

- Node.js 22 or later and npm.
- Windows, macOS, or Linux to run the project. Some tools are platform-specific.
- On Windows, the .NET 8 SDK is required to build the sensor collector. Visual Studio Build Tools with C++ are required to build the native process monitor.

### Getting started

From the project folder, install dependencies and start the app:

```powershell
npm ci
npm run dev
```

On Windows, development startup attempts to prepare the native components. If the .NET 8 SDK or C++ build tools are missing, some sensor or process data may be unavailable; the rest of the app can continue using available fallbacks.

### Checks and builds

```powershell
npm run check       # type, style, rules, and test checks
npm run qa:smoke    # automated checks with a report
npm run build       # build the application
```

To create distribution packages:

```powershell
npm run package:win
npm run package:mac
npm run package:linux
```

Generated files are placed in `dist/`. The Windows package includes the sensor collector and native process monitor.

### Documentation

- [Build and distribution](docs/BUILD.en.md)
- [Hardware monitoring](docs/HARDWARE-MONITORING.en.md)
- [Testing and QA reports](docs/TESTING.en.md)
- [Command-line usage](CLI.en.md)
- [Security](SECURITY.en.md)
- [Cleaning rules](rules/RULES.en.md)
- [Rules catalog](rules/CATALOG.en.md)
- [Third-party notices](THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.en.md)

### Project structure

```text
src/       Application code, interface, and services
docs/      Development and usage guides
rules/     Analysis and cleaning rules
scripts/   Build, validation, and QA tools
resources/ Assets included in packages
native/    Windows native components
tools/     Sensor collector source code
```

### Responsible use

Review items before removing them and read Atlas's confirmations. Changes to the Registry, services, firewall, drivers, or system files can affect Windows. Make backups when appropriate.
