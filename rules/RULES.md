# Contribuir com regras de limpeza

**English:** [Cleaning rules contribution guide](RULES.en.md)

As regras de limpeza do Atlas são arquivos JSON separados por sistema operacional. Você pode acrescentar ou corrigir uma regra sem alterar a interface do aplicativo.

## Estrutura

```text
rules/
  schema/rules.schema.json
  win32/      Regras para Windows
  darwin/     Regras para macOS
  linux/      Regras para Linux
```

Cada pasta de sistema pode conter regras para aplicativos, navegadores, jogos, cache gráfico, arquivos do sistema e bancos de dados. Consulte os arquivos JSON existentes antes de criar uma entrada.

## Ferramentas

```powershell
npm run new-rule
npm run find-cache
npm run preview-rule
npm run parity-check
npm run validate:rules
npm run catalog
```

O gerador `new-rule` orienta a criação de uma regra. `preview-rule` mostra o que seria analisado sem apagar arquivos. `catalog` atualiza o [catálogo de regras](CATALOG.md).

## Criar uma regra

Adicione a entrada ao arquivo JSON da plataforma correspondente. Um exemplo simplificado:

```json
{
  "id": "acme-editor",
  "name": "Acme Editor",
  "paths": [
    "${APPDATA}/AcmeEditor/Cache/Cache_Data",
    "${APPDATA}/AcmeEditor/logs"
  ],
  "description": "Cache e logs do aplicativo"
}
```

Use caminhos absolutos a partir das variáveis suportadas pelo projeto. Não inclua documentos, preferências, credenciais, tokens de sessão, favoritos, jogos salvos ou outros dados do usuário.

## Variáveis de caminho

Os caminhos usam variáveis definidas no carregador de regras. Exemplos comuns:

| Variável | Windows | macOS | Linux |
| --- | --- | --- | --- |
| `${HOME}` | Pasta do usuário | Pasta do usuário | Pasta do usuário |
| `${APPDATA}` | Dados em Roaming | — | — |
| `${LOCALAPPDATA}` | Dados locais | — | — |
| `${WINDIR}` | Pasta do Windows | — | — |
| `${PROGRAMDATA}` | Dados compartilhados de programas | — | — |
| `${PROGRAMFILES}` | Arquivos de programas | — | — |
| `${PROGRAMFILES_X86}` | Arquivos de programas de 32 bits | — | — |
| `${LIBRARY}` | — | `~/Library` | — |
| `${CACHES}` | — | `~/Library/Caches` | — |
| `${CONFIG}` | — | — | `~/.config` |
| `${CACHE}` | — | — | `~/.cache` |
| `${TMPDIR}` | Diretório temporário | Diretório temporário | Diretório temporário |

Confira a implementação e o esquema JSON para ver a lista completa e as variáveis válidas em cada plataforma.

## Cuidados com os campos

- Use IDs em letras minúsculas e hífens, por exemplo `meu-aplicativo`.
- Use `/` nos caminhos do JSON; o carregador adapta o separador no Windows.
- Informe ao menos um caminho e explique na descrição o que será removido.
- Use `minAgeDays` quando arquivos recentes precisarem ser preservados.
- Use `childSubdir`, `recursiveMatch` ou `fileMatch` somente quando o formato da pasta exigir isso; essas opções têm restrições e não devem ampliar a área limpa.
- Para tarefas que exigem administrador, marque `needsAdmin` na regra de sistema.
- Alguns caches de desempenho podem precisar de `cacheReset`; isso deve ser indicado com uma explicação de que a próxima abertura do programa pode ser mais lenta.
- As opções disponíveis e seus limites são definidos em `schema/rules.schema.json` e no código que carrega as regras.

## Validar antes de enviar

```powershell
npm run validate:rules
npm test
```

Confirme que os caminhos existem em uma instalação real e contêm somente dados descartáveis. Prefira não adicionar uma regra quando não for possível provar que os arquivos são seguros para remoção.
