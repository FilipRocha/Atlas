# Histórico de alterações — Atlas

Este arquivo resume mudanças relevantes do projeto. A versão publicada está definida em `package.json`.

## 3.4.0

### Monitoramento

- O monitor prioriza os contadores WDDM do Windows para uso da GPU.
- AMD, Intel e NVIDIA são detectadas sem configuração manual por computador.
- A carga é calculada pelo mecanismo ativo mais ocupado, sem somar mecanismos diferentes acima de 100%.
- O LibreHardwareMonitor e `systeminformation` complementam as leituras quando necessário.
- A tela de desempenho e o monitor sobreposto usam o mesmo serviço de monitoramento.
- A identificação e a utilização da GPU combinam informações do Windows e do `systeminformation`.
- O nome da placa continua disponível quando a leitura de utilização está temporariamente indisponível.

### Interface e softwares

- A barra lateral foi reorganizada e a seção **Pesquisa Software** passou a se chamar **Instalar Softwares**.
- O catálogo de instalação foi dividido em categorias, incluindo Essenciais, Desenvolvimento, Games e Office.
- Os ícones do catálogo foram padronizados e a identificação visual dos programas instalados foi aprimorada.
- Operações de atualização em lote passaram a solicitar confirmação.

### Desinstalação e manutenção

- A busca por programas instalados considera diferentes áreas e visualizações do Registro do Windows.
- Após uma desinstalação, o Atlas pode localizar resíduos relacionados para revisão do usuário.
- SFC, DISM e CHKDSK usam os executáveis oficiais do Windows com os argumentos necessários.
- Foram reforçadas confirmações para ações administrativas e operações que podem remover dados.

### Recursos mantidos

- Limpeza, armazenamento, rede, privacidade, segurança, inicialização, serviços e firewall.
- Ferramentas de reparo do Windows, monitoramento de desempenho, Game Mode, drivers e recuperação.
- As funções administrativas continuam sujeitas às permissões e aos avisos do Windows.
