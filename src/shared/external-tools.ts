export interface ExternalTool {
  id: string
  name: string
  category: 'apps' | 'cleanup' | 'storage' | 'diagnostics' | 'backup' | 'recovery' | 'network'
  description: string
  /** Official GitHub project or vendor page. */
  siteUrl: string
  /** GitHub repository used only to resolve its latest published release asset. */
  releaseRepo?: string
  /** Conservative hint used when a release publishes more than one Windows asset. */
  assetHint?: string
  windowsOnly?: boolean
  caution?: string
}

// Catalog values are trusted inputs for IPC. The renderer may send only an id;
// URLs, repositories, and filenames are always resolved from this fixed list.
export const EXTERNAL_TOOLS: ExternalTool[] = [
  {
    id: 'unigetui',
    name: 'UniGetUI',
    category: 'apps',
    description: 'Instalar e atualizar programas por gerenciadores de pacotes.',
    siteUrl: 'https://github.com/Devolutions/UniGetUI',
    releaseRepo: 'Devolutions/UniGetUI',
    assetHint: 'windows|win|x64|msix|setup'
  },
  {
    id: 'bleachbit',
    name: 'BleachBit',
    category: 'cleanup',
    description: 'Limpar arquivos temporários e dados selecionados de aplicativos.',
    siteUrl: 'https://github.com/bleachbit/bleachbit',
    releaseRepo: 'bleachbit/bleachbit',
    assetHint: 'windows|win|setup|installer'
  },
  {
    id: 'bcuninstaller',
    name: 'BCUninstaller',
    category: 'apps',
    description: 'Desinstalar programas e revisar itens restantes.',
    siteUrl: 'https://github.com/BCUninstaller/Bulk-Crap-Uninstaller',
    releaseRepo: 'BCUninstaller/Bulk-Crap-Uninstaller',
    assetHint: 'windows|win|setup|installer|portable'
  },
  {
    id: 'windirstat',
    name: 'WinDirStat',
    category: 'storage',
    description: 'Visualizar o que ocupa espaço nos discos e nas pastas.',
    siteUrl: 'https://github.com/windirstat/windirstat',
    releaseRepo: 'windirstat/windirstat',
    assetHint: 'windows|win|x64|setup|installer'
  },
  {
    id: 'krokiet',
    name: 'Krokiet',
    category: 'storage',
    description: 'Encontrar arquivos duplicados e semelhantes.',
    siteUrl: 'https://github.com/qarmin/czkawka',
    releaseRepo: 'qarmin/czkawka',
    assetHint: 'windows_krokiet_on_windows_skia_opengl'
  },
  {
    id: 'winhance',
    name: 'Winhance',
    category: 'apps',
    description: 'Personalizar e ajustar configurações do Windows.',
    siteUrl: 'https://github.com/memstechtips/Winhance',
    releaseRepo: 'memstechtips/Winhance',
    assetHint: 'windows|win|x64|setup|installer'
  },
  {
    id: 'privacy-sexy',
    name: 'privacy.sexy',
    category: 'apps',
    description: 'Preparar ajustes de privacidade para revisão antes de aplicar.',
    siteUrl: 'https://github.com/undergroundwires/privacy.sexy',
    releaseRepo: 'undergroundwires/privacy.sexy',
    assetHint: 'windows|win|x64|setup|installer',
    caution: 'Revise qualquer script antes de executá-lo.'
  },
  {
    id: 'librehardwaremonitor',
    name: 'LibreHardwareMonitor',
    category: 'diagnostics',
    description: 'Consultar sensores, temperaturas e dados de hardware.',
    siteUrl: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor',
    releaseRepo: 'LibreHardwareMonitor/LibreHardwareMonitor',
    assetHint: 'windows|win|x64|zip'
  },
  {
    id: 'duplicati',
    name: 'Duplicati',
    category: 'backup',
    description: 'Criar cópias de segurança locais ou remotas.',
    siteUrl: 'https://github.com/duplicati/duplicati',
    releaseRepo: 'duplicati/duplicati',
    assetHint: 'windows|win|x64|msi|exe'
  },
  {
    id: 'testdisk',
    name: 'TestDisk / PhotoRec',
    category: 'recovery',
    description: 'Tentar recuperar partições ou arquivos perdidos.',
    siteUrl: 'https://github.com/cgsecurity/testdisk'
  },
  {
    id: 'driverstore-explorer',
    name: 'DriverStoreExplorer',
    category: 'diagnostics',
    description: 'Inspecionar pacotes de drivers armazenados no Windows.',
    siteUrl: 'https://github.com/lostindark/DriverStoreExplorer',
    releaseRepo: 'lostindark/DriverStoreExplorer',
    assetHint: 'windows|win|x64|zip',
    caution: 'Remover drivers pode afetar dispositivos. Não remova itens sem saber para que servem.'
  },
  {
    id: 'wireshark',
    name: 'Wireshark',
    category: 'network',
    description: 'Analisar conexões e tráfego de rede em diagnósticos avançados.',
    siteUrl: 'https://github.com/wireshark/wireshark'
  },
  {
    id: 'ventoy',
    name: 'Ventoy',
    category: 'recovery',
    description: 'Preparar um pendrive inicializável com imagens de sistema.',
    siteUrl: 'https://github.com/ventoy/Ventoy',
    releaseRepo: 'ventoy/Ventoy',
    assetHint: 'windows|win|zip',
    caution:
      'Preparar o pendrive modifica o dispositivo. Confira com atenção qual unidade está selecionada.'
  },
  {
    id: 'hwinfo',
    name: 'HWiNFO',
    category: 'diagnostics',
    description: 'Consultar inventário detalhado e sensores do computador.',
    siteUrl: 'https://www.hwinfo.com/download/',
    windowsOnly: true,
    caution: 'Gratuito para uso pessoal; não é open source.'
  },
  {
    id: 'memtest86',
    name: 'MemTest86',
    category: 'diagnostics',
    description: 'Testar a memória RAM inicializando o computador por um pendrive.',
    siteUrl: 'https://www.memtest86.com/download.htm',
    windowsOnly: true,
    caution: 'A edição gratuita não é open source e requer um pendrive inicializável.'
  },
  {
    id: 'crystaldiskinfo',
    name: 'CrystalDiskInfo',
    category: 'diagnostics',
    description: 'Verificar indicadores de saúde e temperatura de unidades de armazenamento.',
    siteUrl: 'https://github.com/CrystalDewWorld/CrystalDiskInfo',
    releaseRepo: 'CrystalDewWorld/CrystalDiskInfo',
    assetHint: 'windows|win|x64|zip|installer'
  }
]

export const POST_FORMAT_CHECKLIST = [
  'Ativar o Windows e confirmar edição e licença',
  'Instalar atualizações do Windows e reiniciar',
  'Instalar drivers pelo Windows Update ou fabricante do computador',
  'Instalar os programas essenciais usados no dia a dia',
  'Atualizar a Segurança do Windows e fazer uma verificação',
  'Criar um ponto de restauração antes de ajustes',
  'Fazer backup dos documentos em outro disco ou na nuvem',
  'Preparar uma mídia de recuperação em um pendrive vazio',
  'Conferir internet, áudio, Bluetooth, impressora e Gerenciador de Dispositivos'
]
