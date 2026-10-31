import { BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { PerfMonitorService } from '../services/perf-monitor'
import type { PerfQuickStats } from '../../shared/types'

// Quick stats are served from the same PerfMonitorService snapshot used by
// the Performance page and the overlay.

// Critical Windows processes that must never be killed by the user.
// Terminating these can cause a BSOD, logon failure, or system instability.
const PROTECTED_PROCESS_NAMES = new Set([
  'csrss.exe', // Client/Server Runtime — BSOD if killed
  'smss.exe', // Session Manager — BSOD if killed
  'wininit.exe', // Windows Init — BSOD if killed
  'services.exe', // Service Control Manager
  'lsass.exe', // Local Security Authority — logon/auth
  'lsaiso.exe', // LSA Isolated (Credential Guard)
  'svchost.exe', // Hosts many core OS services
  'winlogon.exe', // Logon session manager
  'dwm.exe', // Desktop Window Manager — desktop crashes
  'explorer.exe', // Windows shell — taskbar/desktop disappears
  'ntoskrnl.exe', // Kernel image
  'system', // Kernel-mode system process
  'registry', // Registry hive process
  'memory compression', // Memory management
  // macOS / Linux equivalents
  'launchd', // macOS PID 1
  'kernel_task', // macOS kernel
  'windowserver', // macOS display server
  'systemd', // Linux PID 1
  'init', // Linux PID 1 (SysVinit)
  'kthreadd', // Linux kernel threads
  'gdm', // GNOME Display Manager
  'sddm', // KDE Display Manager
  'lightdm', // Light Display Manager
  'xorg', // X11 display server
  'xwayland' // XWayland display server
])

export function registerPerfMonitorIpc(getWindow: () => Electron.BrowserWindow | null): void {
  const service = new PerfMonitorService()

  // Track whether the renderer explicitly requested monitoring so we can
  // auto-pause when the window is hidden and resume when shown again.
  let rendererRequestedMonitoring = false
  let attachedWindowId: number | null = null

  function attachWindowListeners(win: Electron.BrowserWindow): void {
    if (win.id === attachedWindowId) return
    attachedWindowId = win.id

    win.on('hide', () => {
      if (rendererRequestedMonitoring) service.stopMonitoring()
    })
    win.on('show', () => {
      if (rendererRequestedMonitoring && !win.webContents.isDestroyed()) {
        service.startMonitoring(win.webContents)
      }
    })
  }

  // The dashboard uses native OS counters only; it must never trigger the
  // overlay's disk discovery or systeminformation/PowerShell fallbacks.
  ipcMain.handle(IPC.PERF_QUICK_STATS, async (): Promise<PerfQuickStats> => {
    const stats = service.getQuickStats()
    return {
      ...stats,
      cpuPercent: stats.cpuPercent == null ? null : Math.round(stats.cpuPercent),
      memPercent: Math.round(stats.memPercent)
    }
  })

  ipcMain.handle(IPC.PERF_GET_SYSTEM_INFO, () => service.getSystemInfo())

  ipcMain.handle(IPC.PERF_START_MONITORING, (event) => {
    rendererRequestedMonitoring = true

    // Attach hide/show listeners to the current window if not already attached
    const win = getWindow()
    if (win) attachWindowListeners(win)

    return service.startMonitoring(event.sender)
  })

  ipcMain.handle(IPC.PERF_STOP_MONITORING, () => {
    rendererRequestedMonitoring = false
    service.stopMonitoring()
  })

  ipcMain.handle(IPC.PERF_KILL_PROCESS, async (_event, pid: number) => {
    // Validate pid is a positive integer and not a critical system process
    if (!Number.isInteger(pid) || pid <= 0) {
      return { success: false, error: 'Invalid process ID' }
    }
    // Block PID 0 (System Idle / kernel), PID 1 (init/launchd), PID 4 (Windows System)
    if (pid <= 4) {
      return { success: false, error: 'Cannot kill critical system process' }
    }
    // Prevent the app from killing itself
    if (pid === process.pid) {
      return { success: false, error: 'Cannot kill own process' }
    }
    // Look up the process name and block protected system processes
    const processName = await service.getProcessName(pid)
    if (processName && PROTECTED_PROCESS_NAMES.has(processName.toLowerCase())) {
      return { success: false, error: `Cannot kill protected system process (${processName})` }
    }
    return service.killProcess(pid)
  })

  ipcMain.handle(IPC.PERF_DISK_HEALTH, () => service.getDiskHealth())
  ipcMain.handle(IPC.PERF_SENSOR_DRIVER_STATUS, () => service.getSensorDriverStatus())
  ipcMain.handle(IPC.PERF_INSTALL_PAWNIO, () => service.installPawnIo())
  ipcMain.handle(IPC.PERF_OVERLAY_STATS, () => service.getOverlayStats())

  let overlayWindow: BrowserWindow | null = null
  let overlayTopBarVisible = true
  let overlayPinned = true
  let overlayBounds = { width: 560, height: 360 }
  const overlayMetrics: Record<string, boolean> = {
    cpu: true,
    memory: true,
    disk: true,
    network: true,
    gpu: true,
    temperature: true
  }

  ipcMain.handle(IPC.PERF_OVERLAY_OPEN, () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive()
      overlayWindow.focus()
      return true
    }
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const initialWidth = Math.max(100, Math.min(4000, Math.round(overlayBounds.width)))
    const initialHeight = Math.max(30, Math.min(3000, Math.round(overlayBounds.height)))
    overlayWindow = new BrowserWindow({
      width: initialWidth,
      height: initialHeight,
      minWidth: 100,
      minHeight: 30,
      x: Math.max(0, width - 400),
      y: Math.max(0, height - 280),
      frame: false,
      transparent: true,
      resizable: true,
      movable: true,
      alwaysOnTop: overlayPinned,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    const url = process.env['ELECTRON_RENDERER_URL']
    if (url) {
      overlayWindow.loadURL(`${url}#/performance-overlay`)
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/performance-overlay'
      })
    }

    overlayWindow.on('resize', () => {
      if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.isMaximized()) return
      const [currentWidth, currentHeight] = overlayWindow.getSize()
      overlayBounds = { width: currentWidth, height: currentHeight }
    })

    overlayWindow.webContents.on('context-menu', () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return
      const menu = Menu.buildFromTemplate([
        {
          label: overlayTopBarVisible ? 'Ocultar barra superior' : 'Mostrar barra superior',
          click: () => {
            overlayTopBarVisible = !overlayTopBarVisible
            overlayWindow?.webContents.send(IPC.PERF_OVERLAY_COMMAND, {
              type: 'top-bar',
              visible: overlayTopBarVisible
            })
          }
        },
        {
          type: 'separator'
        },
        {
          label: overlayWindow.isAlwaysOnTop() ? 'Desativar sobreposição' : 'Ativar sobreposição',
          click: () => {
            const enabled = !overlayWindow?.isAlwaysOnTop()
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayPinned = Boolean(enabled)
              overlayWindow.setAlwaysOnTop(overlayPinned, 'floating')
              overlayWindow.webContents.send(IPC.PERF_OVERLAY_COMMAND, {
                type: 'pin',
                enabled: overlayPinned
              })
            }
          }
        },
        {
          label: 'Informações',
          submenu: (['cpu', 'memory', 'disk', 'network', 'gpu', 'temperature'] as const).map(
            (key) => {
              const labels = {
                cpu: 'CPU',
                memory: 'Memória',
                disk: 'Discos',
                network: 'Rede',
                gpu: 'GPU',
                temperature: 'Temperaturas (CPU + GPU)'
              }
              return {
                label: labels[key],
                type: 'checkbox' as const,
                checked: overlayMetrics[key],
                click: () => {
                  overlayMetrics[key] = !overlayMetrics[key]
                  overlayWindow?.webContents.send(IPC.PERF_OVERLAY_COMMAND, {
                    type: 'metric',
                    key,
                    enabled: overlayMetrics[key]
                  })
                }
              }
            }
          )
        },
        { type: 'separator' },
        {
          label: overlayWindow.isMaximized() ? 'Restaurar tamanho' : 'Maximizar',
          click: () => {
            if (!overlayWindow || overlayWindow.isDestroyed()) return
            if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
            else overlayWindow.maximize()
          }
        },
        {
          label: 'Minimizar',
          click: () => overlayWindow?.minimize()
        },
        {
          type: 'separator'
        },
        {
          label: 'Fechar monitor',
          click: () => overlayWindow?.close()
        }
      ])
      menu.popup({ window: overlayWindow })
    })

    overlayWindow.on('closed', () => {
      overlayWindow = null
    })
    return true
  })

  ipcMain.handle(IPC.PERF_OVERLAY_SET_METRIC, (event, key: string, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (
      !win ||
      win !== overlayWindow ||
      typeof key !== 'string' ||
      typeof enabled !== 'boolean' ||
      !(key in overlayMetrics)
    )
      return false
    overlayMetrics[key] = enabled
    win.webContents.send(IPC.PERF_OVERLAY_COMMAND, { type: 'metric', key, enabled })
    return true
  })

  ipcMain.handle(IPC.PERF_OVERLAY_SET_TOP_BAR, (event, visible: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || typeof visible !== 'boolean') return false
    if (win === overlayWindow) overlayTopBarVisible = visible
    win.webContents.send(IPC.PERF_OVERLAY_COMMAND, { type: 'top-bar', visible })
    return true
  })

  ipcMain.handle(IPC.PERF_OVERLAY_SET_ALWAYS_ON_TOP, (event, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof enabled !== 'boolean') return false
    win.setAlwaysOnTop(enabled, 'floating')
    const actual = win.isAlwaysOnTop()
    if (win === overlayWindow) overlayPinned = actual
    return actual
  })

  ipcMain.handle(IPC.PERF_OVERLAY_GET_ALWAYS_ON_TOP, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return Boolean(win && !win.isDestroyed() && win.isAlwaysOnTop())
  })

  ipcMain.handle(IPC.PERF_OVERLAY_SET_SIZE, (event, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    const safeWidth = Math.max(100, Math.min(4000, Math.round(Number(width))))
    const safeHeight = Math.max(30, Math.min(3000, Math.round(Number(height))))
    if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight)) return false
    win.setSize(safeWidth, safeHeight, true)
    return true
  })

  ipcMain.handle(IPC.PERF_OVERLAY_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.minimize()
  })

  ipcMain.handle(IPC.PERF_OVERLAY_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })

  ipcMain.handle(IPC.PERF_OVERLAY_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
  })
}
