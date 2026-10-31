# Compilação e distribuição

**English:** [Build and distribution](BUILD.en.md)

Este guia cobre a preparação do ambiente, o desenvolvimento e a criação dos pacotes do Atlas.

## Requisitos

- Node.js 22 ou mais recente e npm.
- Para compilar o pacote do Windows: Windows x64, .NET 8 SDK e Visual Studio Build Tools com a carga de trabalho de desenvolvimento para desktop com C++.
- Para gerar pacotes de macOS ou Linux, faça o build no sistema correspondente. A assinatura e a notarização do macOS também dependem das credenciais de distribuição da Apple.

## Instalar dependências

Abra um terminal na pasta do projeto e execute:

```powershell
npm ci
```

Esse comando instala as versões registradas em `package-lock.json`.

## Executar durante o desenvolvimento

```powershell
npm run dev
```

No Windows, o comando prepara o coletor de sensores e tenta compilar o monitor nativo de processos. Se faltar uma ferramenta de compilação, o Atlas avisa e pode usar alternativas para continuar o desenvolvimento. Para compilar o coletor de hardware manualmente:

```powershell
npm run build:hardware-bridge
```

Para exigir a compilação do monitor nativo de processos:

```powershell
npm run build:process-monitor
```

## Verificar e compilar

```powershell
npm run check
npm run build
```

`npm run check` executa a verificação de tipos, o linter, a validação de formatação e das regras, além dos testes automatizados. `npm run build` compila o aplicativo, mas não cria um instalador.

## Criar pacotes

```powershell
npm run package:win
npm run package:mac
npm run package:linux
```

Os pacotes são gravados em `dist/`. No Windows, `package:win` compila os componentes nativos necessários e gera o instalador e a versão portátil x64. O instalador solicita autorização do Windows quando necessário.

O build do Windows baixa o pacote App Installer diretamente de uma versão oficial do WinGet e confere o tamanho e o SHA-256 publicados pelo GitHub. O arquivo, com mais de 200 MB, fica local em `resources/winget/` e não deve ser adicionado ao repositório.

O coletor compilado também inclui os avisos e licenças de terceiros em sua pasta de recursos. Consulte [os avisos do coletor](../THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md) para ver as dependências e suas fontes.

Os comandos de macOS e Linux devem ser executados no sistema de destino. Os formatos gerados estão definidos em `electron-builder.yml`.

## Relatórios de QA

Para gerar um relatório automatizado:

```powershell
npm run qa:smoke
npm run qa:app-smoke
```

Os relatórios ficam em `qa-reports/`. O primeiro comando verifica o código e os testes. O segundo compila e inicia uma instância isolada do Atlas para verificar a abertura da janela, a navegação e consultas selecionadas. Ele não deve executar ações de limpeza ou alterar configurações do sistema.

Mais detalhes: [Testes e relatórios de QA](TESTES.md).

## Código-fonte e arquivos gerados

O código-fonte fica separado dos arquivos criados durante a instalação ou o build. `node_modules/`, `out/`, `dist/` e os diretórios de compilação nativa são gerados localmente e podem ser recriados conforme as instruções deste guia. Os ícones em `resources/` são assets do projeto; `resources/hardware-bridge/` e o pacote em `resources/winget/` são gerados ou baixados durante a preparação do Windows e não devem ser adicionados ao Git.

## Arquivos de configuração

- `package.json`: comandos e dependências do projeto.
- `package-lock.json`: versões exatas das dependências npm.
- `electron.vite.config.ts`: configuração de build do Electron e da interface.
- `electron-builder.yml`: instaladores, recursos e destinos de distribuição.
- `tsconfig*.json`: configuração do TypeScript.
