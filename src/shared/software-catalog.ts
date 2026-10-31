// Catálogo de instalação sugerido do Atlas.
// Os IDs abaixo são os identificadores do WinGet usados para instalação.
// Mantemos os quatro kits pedidos na interface: Essencial, DEV, Gamer e Escritório.

export type SoftwareCategory =
  | 'browsers'
  | 'runtimes'
  | 'communication'
  | 'gaming-platforms'
  | 'gamer-extras'
  | 'office'
  | 'utilities'
  | 'diagnostics'
  | 'security'
  | 'multimedia'
  | 'creative'
  | 'dev'
  | 'network'
  | 'cloud'

export type KitId = 'basico' | 'dev' | 'gamer' | 'escritorio'

export interface SoftwareCatalogEntry {
  id: string
  name: string
  category: SoftwareCategory
  kits: KitId[]
  installMethod: 'winget'
  wingetId: string
  iconSlug?: string
}

export const SOFTWARE_CATEGORIES: { id: SoftwareCategory; label: string }[] = [
  { id: 'browsers', label: 'Navegação' },
  { id: 'utilities', label: 'Utilidades' },
  { id: 'multimedia', label: 'Mídia' },
  { id: 'communication', label: 'Comunicação' },
  { id: 'dev', label: 'Programação' },
  { id: 'runtimes', label: 'Runtimes' },
  { id: 'gaming-platforms', label: 'Launchers' },
  { id: 'gamer-extras', label: 'Ferramentas Gamer' },
  { id: 'office', label: 'Escritório' },
  { id: 'cloud', label: 'Nuvem' },
  { id: 'network', label: 'Rede e Suporte' },
  { id: 'security', label: 'Segurança' }
]

export interface SoftwareKitDefinition {
  id: KitId
  label: string
  description: string
}

export const SOFTWARE_KITS: SoftwareKitDefinition[] = [
  {
    id: 'basico',
    label: 'Essencial',
    description: 'Navegação, utilidades, mídia, comunicação e suporte.'
  },
  {
    id: 'dev',
    label: 'DEV',
    description: 'Programação, terminais, runtimes, Git, APIs e bancos de dados.'
  },
  {
    id: 'gamer',
    label: 'Gamer',
    description: 'Launchers, comunicação, otimização, drivers e gravação.'
  },
  {
    id: 'escritorio',
    label: 'Escritório',
    description: 'Produtividade, PDF, reuniões, notas e armazenamento em nuvem.'
  }
]

export const SOFTWARE_CATALOG: SoftwareCatalogEntry[] = [
  // ─── 1. Essencial ──────────────────────────────────────────
  {
    id: 'chrome',
    name: 'Google Chrome',
    category: 'browsers',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Google.Chrome',
    iconSlug: 'googlechrome'
  },
  {
    id: 'firefox',
    name: 'Mozilla Firefox',
    category: 'browsers',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Mozilla.Firefox',
    iconSlug: 'firefoxbrowser'
  },
  {
    id: 'brave',
    name: 'Brave Browser',
    category: 'browsers',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Brave.Brave',
    iconSlug: 'brave'
  },
  {
    id: 'opera-gx',
    name: 'Opera GX',
    category: 'browsers',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Opera.OperaGX',
    iconSlug: 'operagx'
  },
  {
    id: '7zip',
    name: '7-Zip',
    category: 'utilities',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: '7zip.7zip',
    iconSlug: '7zip'
  },
  {
    id: 'winrar',
    name: 'WinRAR',
    category: 'utilities',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'RARLab.WinRAR',
    iconSlug: 'winrar'
  },
  {
    id: 'vlc',
    name: 'VLC Media Player',
    category: 'multimedia',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'VideoLAN.VLC',
    iconSlug: 'vlcmediaplayer'
  },
  {
    id: 'klite-basic',
    name: 'K-Lite Codec Pack Basic',
    category: 'multimedia',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'CodecGuide.K-LiteCodecPack.Basic',
    iconSlug: 'klite'
  },
  {
    id: 'spotify',
    name: 'Spotify',
    category: 'multimedia',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Spotify.Spotify',
    iconSlug: 'spotify'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'communication',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'WhatsApp.WhatsApp',
    iconSlug: 'whatsapp'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'communication',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Telegram.TelegramDesktop',
    iconSlug: 'telegram'
  },
  {
    id: 'anydesk',
    name: 'AnyDesk',
    category: 'network',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'AnyDeskSoftwareGmbH.AnyDesk',
    iconSlug: 'anydesk'
  },
  {
    id: 'teamviewer',
    name: 'TeamViewer',
    category: 'network',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'TeamViewer.TeamViewer',
    iconSlug: 'teamviewer'
  },
  {
    id: 'lightshot',
    name: 'Lightshot',
    category: 'utilities',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Skillbrains.Lightshot'
  },
  {
    id: 'rufus',
    name: 'Rufus',
    category: 'utilities',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Rufus.Rufus',
    iconSlug: 'rufus'
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    category: 'security',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'Bitwarden.Bitwarden',
    iconSlug: 'bitwarden'
  },
  {
    id: 'everything',
    name: 'Everything',
    category: 'utilities',
    kits: ['basico'],
    installMethod: 'winget',
    wingetId: 'voidtools.Everything'
  },

  // ─── 2. DEV ────────────────────────────────────────────────
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Microsoft.VisualStudioCode',
    iconSlug: 'visualstudiocode'
  },
  {
    id: 'notepadpp',
    name: 'Notepad++',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Notepad++.Notepad++',
    iconSlug: 'notepadplusplus'
  },
  {
    id: 'git',
    name: 'Git',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Git.Git',
    iconSlug: 'gitforwindows'
  },
  {
    id: 'github-desktop',
    name: 'GitHub Desktop',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'GitHub.GitHubDesktop',
    iconSlug: 'github'
  },
  {
    id: 'nodejs',
    name: 'Node.js',
    category: 'runtimes',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'OpenJS.NodeJS',
    iconSlug: 'nodedotjs'
  },
  {
    id: 'python311',
    name: 'Python 3.11',
    category: 'runtimes',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Python.Python.3.11',
    iconSlug: 'python'
  },
  {
    id: 'jdk21',
    name: 'Java SE Development Kit 21',
    category: 'runtimes',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Oracle.JDK.21',
    iconSlug: 'openjdk'
  },
  {
    id: 'docker-desktop',
    name: 'Docker Desktop',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Docker.DockerDesktop',
    iconSlug: 'docker'
  },
  {
    id: 'postman',
    name: 'Postman',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Postman.Postman',
    iconSlug: 'postman'
  },
  {
    id: 'dbeaver',
    name: 'DBeaver',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'dbeaver.dbeaver',
    iconSlug: 'dbeaver'
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    category: 'dev',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'Microsoft.WindowsTerminal'
  },
  {
    id: 'putty',
    name: 'PuTTY',
    category: 'network',
    kits: ['dev'],
    installMethod: 'winget',
    wingetId: 'PuTTY.PuTTY',
    iconSlug: 'putty'
  },

  // ─── 3. Gamer ──────────────────────────────────────────────
  {
    id: 'steam',
    name: 'Steam',
    category: 'gaming-platforms',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Valve.Steam',
    iconSlug: 'steam'
  },
  {
    id: 'epic-games',
    name: 'Epic Games Launcher',
    category: 'gaming-platforms',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'EpicGames.EpicGamesLauncher',
    iconSlug: 'epicgames'
  },
  {
    id: 'riot-client',
    name: 'Riot Client',
    category: 'gaming-platforms',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'RiotGames.RiotClient',
    iconSlug: 'riotgames'
  },
  {
    id: 'ea-app',
    name: 'EA app',
    category: 'gaming-platforms',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'ElectronicArts.EADesktop',
    iconSlug: 'ea'
  },
  {
    id: 'ubisoft-connect',
    name: 'Ubisoft Connect',
    category: 'gaming-platforms',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Ubisoft.Connect',
    iconSlug: 'ubisoft'
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'communication',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Discord.Discord',
    iconSlug: 'discord'
  },
  {
    id: 'obs-studio',
    name: 'OBS Studio',
    category: 'creative',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'OBSProject.OBSStudio',
    iconSlug: 'obsstudio'
  },
  {
    id: 'geforce-experience',
    name: 'GeForce Experience',
    category: 'gamer-extras',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Nvidia.GeForceExperience',
    iconSlug: 'nvidia'
  },
  {
    id: 'msi-afterburner',
    name: 'MSI Afterburner',
    category: 'gamer-extras',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Guru3D.Afterburner',
    iconSlug: 'msi'
  },
  {
    id: 'razer-cortex',
    name: 'Razer Cortex',
    category: 'gamer-extras',
    kits: ['gamer'],
    installMethod: 'winget',
    wingetId: 'Razer.Cortex',
    iconSlug: 'razer'
  },

  // ─── 4. Escritório ─────────────────────────────────────────
  {
    id: 'libreoffice',
    name: 'LibreOffice',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'TheDocumentFoundation.LibreOffice',
    iconSlug: 'libreoffice'
  },
  {
    id: 'acrobat-reader',
    name: 'Adobe Acrobat Reader',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Adobe.Acrobat.Reader.64-bit',
    iconSlug: 'adobeacrobatreader'
  },
  {
    id: 'foxit-reader',
    name: 'Foxit PDF Reader',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Foxit.FoxitReader',
    iconSlug: 'foxit'
  },
  {
    id: 'pdf24',
    name: 'PDF24 Creator',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'GeekSoftware.PDF24',
    iconSlug: 'pdf24'
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'cloud',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Google.Drive',
    iconSlug: 'googledrive'
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'cloud',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Dropbox.Dropbox',
    iconSlug: 'dropbox'
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Zoom.Zoom',
    iconSlug: 'zoom'
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'communication',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Microsoft.Teams',
    iconSlug: 'microsoftteams'
  },
  {
    id: 'skype',
    name: 'Skype',
    category: 'communication',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Microsoft.Skype',
    iconSlug: 'skype'
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Notion.Notion',
    iconSlug: 'notion'
  },
  {
    id: 'evernote',
    name: 'Evernote',
    category: 'office',
    kits: ['escritorio'],
    installMethod: 'winget',
    wingetId: 'Evernote.Evernote',
    iconSlug: 'evernote'
  }
]
