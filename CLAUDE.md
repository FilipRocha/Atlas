# Orientações para trabalhar no Atlas

**English:** [Atlas development guide](CLAUDE.en.md)

O Atlas é um aplicativo de manutenção feito com Electron, React e TypeScript. Preserve o comportamento existente e consulte os arquivos próximos à mudança antes de editar.

## Desenvolvimento

```powershell
npm ci
npm run dev
```

Os comandos de QA, build e distribuição estão em `package.json` e são descritos em `docs/BUILD.md` e `docs/TESTES.md`.

## Verificações

```powershell
npm run check
npm test
npm run typecheck
npm run lint
npm run format:check
npm run validate:rules
```

Execute as verificações relevantes para a alteração. Não rode formatadores em todo o projeto quando apenas um arquivo precisar de ajuste.

## Commits e releases

Use mensagens no formato Conventional Commits:

```text
<tipo>(<escopo>): <resumo curto>
```

Tipos comuns: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci` e `chore`. O comando `npm run release -- patch|minor|major` coordena a versão e o processo de release; só o execute quando isso fizer parte da tarefa.

`conventional-changelog-angular` é uma dependência direta intencional. O gerador de changelog precisa da versão 8 no nível superior de `node_modules`, apesar de outra dependência usar a versão 9. Não remova essa dependência como se estivesse sem uso.

## Exploração do projeto

- Use buscas específicas com `rg` e liste arquivos com `rg --files`.
- Evite procurar dentro de `node_modules`, `out`, `dist`, arquivos gerados e lockfiles, a menos que a tarefa exija isso.
- Leia contexto suficiente antes de mudar comportamento, especialmente em código de sistema, limpeza e operações administrativas.
- Revise todas as alterações antes de concluir o trabalho.
