# Atlas

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

- [Compilação e distribuição](docs/BUILD.md)
- [Monitoramento de hardware](docs/MONITORAMENTO-HARDWARE.md)
- [Testes e relatórios de QA](docs/TESTES.md)
- [Uso pela linha de comando](CLI.md)
- [Segurança](SECURITY.md)
- [Regras de limpeza](rules/RULES.md)
- [Catálogo de regras](rules/CATALOG.md)
- [Avisos de componentes de terceiros](THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md)

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
