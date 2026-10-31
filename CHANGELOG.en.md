# Atlas changelog

**Português:** [Histórico de alterações](CHANGELOG.md)

This file summarizes notable project changes. The published version is defined in `package.json`.

## 3.4.0

### Monitoring

- The monitor prioritizes Windows WDDM counters for GPU usage.
- AMD, Intel, and NVIDIA are detected without per-computer manual configuration.
- Load is calculated from the busiest active engine, without adding different engines above 100%.
- LibreHardwareMonitor and `systeminformation` supplement readings when needed.
- The performance page and overlay monitor use the same monitoring service.
- GPU identification and utilization combine information from Windows and `systeminformation`.
- The graphics card name remains available when utilization readings are temporarily unavailable.

### Interface and software

- The sidebar was reorganized and **Software Search** was renamed **Install Software**.
- The installation catalog was split into categories, including Essentials, Development, Games, and Office.
- Catalog icons were standardized and the visual identification of installed programs was improved.
- Batch update operations now request confirmation.

### Uninstall and maintenance

- Installed program searches now consider different Windows Registry locations and views.
- After an uninstall, Atlas can find related leftovers for the user to review.
- SFC, DISM, and CHKDSK use official Windows executables with the required arguments.
- Confirmations were strengthened for administrative actions and operations that can remove data.

### Retained features

- Cleaning, storage, network, privacy, security, startup, services, and firewall tools.
- Windows repair tools, performance monitoring, Game Mode, drivers, and recovery.
- Administrative features remain subject to Windows permissions and warnings.
