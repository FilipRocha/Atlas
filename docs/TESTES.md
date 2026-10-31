# Testes e relatórios de QA

**English:** [Testing and QA reports](TESTING.en.md)

O projeto oferece verificações rápidas de código e uma verificação de inicialização do aplicativo.

## Dependências

Na raiz do projeto, instale as dependências:

```powershell
npm ci
```

## Verificações de código

```powershell
npm run check
```

Esse comando verifica tipos, lint, formatação, regras JSON e testes unitários. Para gerar um relatório separado de tipos e testes:

```powershell
npm run qa:smoke
```

O relatório é gravado em `qa-reports/qa-report.md` e `qa-reports/qa-report.json`. É possível selecionar as verificações ou mudar a pasta do relatório:

```powershell
npm run qa:smoke -- --only typecheck
npm run qa:smoke -- --only unit-tests --report-dir .\meus-relatorios
```

## Inicialização e navegação do aplicativo

No Windows, execute:

```powershell
npm run qa:app-smoke
```

O verificador cria um perfil temporário isolado, compila o Atlas, abre a janela, percorre as páginas pelo menu, consulta o Gestor de controladores e executa chamadas de leitura. A consulta de atualizações de drivers não instala nem remove drivers. O verificador não aciona funções de limpeza nem modifica configurações do computador.

Os relatórios padrão são `qa-reports/qa-app-report.md` e `qa-reports/qa-app-report.json`. Os limites de inicialização e observação podem ser ajustados:

```powershell
npm run qa:app-smoke -- --startup-timeout-ms 180000 --observe-ms 10000
```

O teste de inicialização cobre um conjunto definido de páginas e consultas; ele não substitui a revisão manual de cada recurso.
