# Segurança

**English:** [Security](SECURITY.en.md)

O Atlas inclui ferramentas que podem remover arquivos ou alterar configurações do sistema. Este documento resume os cuidados para usar e desenvolver o aplicativo.

## Uso do aplicativo

- Leia a descrição e confira os itens selecionados antes de iniciar uma limpeza ou alteração.
- Faça cópias de segurança antes de mudar o Registro, serviços, firewall, drivers ou configurações importantes.
- Algumas funções precisam de privilégios administrativos e podem abrir o pedido de autorização do Windows (UAC).
- Uma detecção de malware, regra YARA ou recomendação automática deve ser investigada antes de apagar um arquivo.
- Reparos do Windows podem demorar e, em alguns casos, exigir reinicialização. Não interrompa a operação sem entender o efeito.

## Desenvolvimento seguro

Ao alterar o projeto:

- Mantenha a interface separada das operações privilegiadas do processo principal do Electron.
- Valide caminhos, parâmetros e entradas antes de usá-los em processos ou APIs do sistema.
- Prefira executar programas conhecidos com argumentos separados, em vez de montar comandos por concatenação.
- Solicite confirmação antes de ações destrutivas ou de grande impacto.
- Use permissões administrativas apenas quando a operação realmente precisar delas.
- Não grave senhas, tokens ou chaves no código, nos relatórios ou nos logs.
- Proteja dados do usuário e evite copiar informações pessoais para registros de diagnóstico.

O uso de ferramentas oficiais do Windows não elimina a necessidade de validar entradas e tratar erros. Revise o comportamento da função em cada sistema compatível antes de distribuir uma alteração.

## Relatar uma falha de segurança

Não publique detalhes que permitam explorar uma vulnerabilidade ainda não corrigida. Se o repositório oferecer um canal privado de segurança, use-o; caso contrário, entre em contato com os mantenedores antes de divulgar o problema. Inclua uma descrição objetiva, passos para reproduzir e o impacto observado. Remova senhas, tokens, chaves e dados pessoais das evidências.

## Verificações do projeto

Antes de enviar uma alteração, execute as verificações aplicáveis:

```powershell
npm run check
npm run build
```

Para orientações de instalação e distribuição, consulte [Compilação e distribuição](docs/BUILD.md). Para informações sobre leituras de hardware, consulte [Monitoramento de hardware](docs/MONITORAMENTO-HARDWARE.md).
