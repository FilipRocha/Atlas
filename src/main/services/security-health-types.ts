// Local security-health data model. Kept independent of any remote service.
export interface SecurityHealthReport {
  // Services that could be optimized
  services: {
    totalRunning: number
    totalDisabled: number
    safeToDisable: number
    byCategory: Record<string, { total: number; running: number; safeToDisable: number }>
  }

  // Privacy score and breakdown
  privacy: {
    score: number
    total: number
    protected: number
    byCategory: Record<string, { total: number; protected: number }>
  }

  // Security posture (native Windows checks)
  securityPosture: {
    antivirus: {
      products: Array<{
        name: string
        enabled: boolean
        realTimeProtection: boolean
        signatureUpToDate: boolean
      }>
      primary: string | null // name of the active AV product
    }
    firewall: {
      enabled: boolean
      products: Array<{ name: string; enabled: boolean }>
      windowsProfiles: { domain: boolean; private: boolean; public: boolean }
    }
    bitlocker: {
      volumes: Array<{
        mount: string
        status:
          | 'FullyEncrypted'
          | 'EncryptionInProgress'
          | 'DecryptionInProgress'
          | 'FullyDecrypted'
          | 'Unknown'
        protectionOn: boolean
      }>
    }
    windowsUpdate: {
      recentPatches: Array<{
        id: string
        installedOn: string
        description: string
      }>
      lastPatchDate: string | null // ISO date of most recent patch
      daysSinceLastPatch: number | null
    }
    screenLock: {
      screenSaverEnabled: boolean
      lockOnResume: boolean // requires password after screensaver
      timeoutSec: number | null // screensaver timeout in seconds
      inactivityLockSec: number | null // GPO/policy inactivity lock (separate from screensaver)
    }
    passwordPolicy: {
      minLength: number
      maxAgeDays: number // 0 = never expires
      minAgeDays: number
      historyCount: number // 0 = no history enforced
      complexityRequired: boolean // whether GPO complexity is enabled
      lockoutThreshold: number // 0 = no lockout
      lockoutDurationMin: number
      lockoutObservationMin: number
      windowsHello: {
        enrolled: boolean // user has NGC credentials set up
        faceEnabled: boolean // Windows Hello Face provider active
        fingerprintEnabled: boolean // Windows Hello Fingerprint provider active
        pinEnabled: boolean // Windows Hello PIN provider active
      }
    }
    sshHardening: {
      isServer: boolean // true if system appears to be a server (no GUI)
      sshdInstalled: boolean // whether sshd is present
      passwordAuthDisabled: boolean // PasswordAuthentication no
      rootLoginDisabled: boolean // PermitRootLogin no or prohibit-password
      pubkeyAuthEnabled: boolean // PubkeyAuthentication yes
      emptyPasswordsDisabled: boolean // PermitEmptyPasswords no
      protocol2Only: boolean // Protocol 2 (legacy check, modern sshd defaults to 2)
    } | null // null when not applicable (e.g. Windows desktop)

    // ─── Server-only checks (null on desktops / non-Linux) ───
    fail2ban: {
      installed: boolean
      active: boolean // systemd service is running
      jails: string[] // active jail names (e.g. ["sshd", "apache-auth"])
      totalBannedIps: number // sum of currently banned IPs across all jails
    } | null

    listeningPorts: Array<{
      address: string // bind address (e.g. "0.0.0.0", "::", "127.0.0.1")
      port: number
      protocol: 'tcp' | 'udp'
      pid: number | null
      process: string | null // process name (e.g. "sshd", "nginx")
    }> | null

    auditd: {
      installed: boolean
      active: boolean // systemd service is running
      ruleCount: number // number of active audit rules
    } | null

    suidSgidBinaries: Array<{
      path: string
      suid: boolean
      sgid: boolean
      owner: string // file owner (e.g. "root")
    }> | null

    firewallStatus: {
      tool: 'ufw' | 'nftables' | 'iptables' | 'firewalld' | 'none'
      active: boolean
      allowedPorts: number[]
      rawRules: string // truncated to 3000 chars
    } | null // null on Windows/macOS
  }
}
