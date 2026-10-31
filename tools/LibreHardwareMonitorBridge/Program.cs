// Atlas hardware bridge. Integrates LibreHardwareMonitorLib 0.9.6.
// LibreHardwareMonitor: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
// License: MPL-2.0. See THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.md.
using System.Text.Json;
using System.Reflection;
using LibreHardwareMonitor.Hardware;

sealed class Snapshot
{
    public int Version { get; init; } = 1;
    public long Timestamp { get; init; }
    public bool Elevated { get; init; }
    public CpuData Cpu { get; init; } = new();
    public List<GpuData> Gpus { get; init; } = new();
    public List<StorageData> Storage { get; init; } = new();
}

sealed class CpuData
{
    public double? Load { get; set; }
    public double? Temperature { get; set; }
    public string? TemperatureSource { get; set; }
    public string? SmuPmTableVersion { get; set; }
}

sealed class GpuData
{
    public string Name { get; set; } = "GPU";
    public double? Load { get; set; }
    public double? Temperature { get; set; }
    public double? Hotspot { get; set; }
    public long? MemoryUsedBytes { get; set; }
    public long? MemoryTotalBytes { get; set; }
    public double? ClockMHz { get; set; }
}

sealed class StorageData
{
    public string Name { get; set; } = "Disk";
    public double? ReadBytesPerSec { get; set; }
    public double? WriteBytesPerSec { get; set; }
    public double? BusyPercent { get; set; }
    public double? Temperature { get; set; }
    // Sensores reais de SMART (null quando o disco nao informa)
    public double? RemainingLifePercent { get; set; }
    public double? PercentUsed { get; set; }
    public double? AvailableSparePercent { get; set; }
}

sealed class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);
    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (var child in hardware.SubHardware) child.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}

static class Program
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.General)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    static bool IsElevated()
    {
        try
        {
            using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            return new System.Security.Principal.WindowsPrincipal(identity)
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    // The SMU read opens a kernel handle each time. When it keeps failing
    // (driver missing / blocked), retry only every 30 s instead of every second.
    static DateTime smuRetryAt = DateTime.MinValue;

    static double? Valid(double? value)
    {
        if (value is null || double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return null;
        return value.Value;
    }

    static double? Valid(float? value)
    {
        if (value is null || float.IsNaN(value.Value) || float.IsInfinity(value.Value)) return null;
        return value.Value;
    }

    static bool IsTemperature(string name) =>
        name.Contains("Temperature", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Tctl", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Tdie", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Package", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Hot Spot", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Hotspot", StringComparison.OrdinalIgnoreCase);

    static double? PickTemperature(IEnumerable<ISensor> sensors, bool hotspot = false)
    {
        var candidates = sensors
            .Where(s => s.SensorType == SensorType.Temperature && s.Value.HasValue && s.Value > 0 && s.Value < 150)
            .Select(s => new { s.Name, Value = Valid(s.Value), Score = ScoreTemperature(s.Name, hotspot) })
            .Where(x => x.Value.HasValue)
            .OrderByDescending(x => x.Score)
            .ToList();
        return candidates.FirstOrDefault()?.Value;
    }

    static int ScoreTemperature(string name, bool hotspot)
    {
        if (hotspot && (name.Contains("Hot Spot", StringComparison.OrdinalIgnoreCase) || name.Contains("Hotspot", StringComparison.OrdinalIgnoreCase))) return 100;
        if (name.Contains("CPU Package", StringComparison.OrdinalIgnoreCase)) return 100;
        if (name.Contains("Package", StringComparison.OrdinalIgnoreCase)) return 95;
        if (name.Contains("Tctl", StringComparison.OrdinalIgnoreCase)) return 94;
        if (name.Contains("Tdie", StringComparison.OrdinalIgnoreCase)) return 93;
        if (name.Contains("Core Max", StringComparison.OrdinalIgnoreCase)) return 92;
        if (name.Contains("Core", StringComparison.OrdinalIgnoreCase)) return 80;
        if (name.Contains("Temperature", StringComparison.OrdinalIgnoreCase)) return 50;
        return 10;
    }

    static double? PickLoad(IEnumerable<ISensor> sensors)
    {
        var candidates = sensors
            .Where(s => s.SensorType == SensorType.Load && s.Value.HasValue && s.Value >= 0 && s.Value <= 100)
            .Select(s => new { s.Name, Value = Valid(s.Value) })
            .Where(x => x.Value.HasValue)
            .ToList();
        return candidates.FirstOrDefault()?.Value;
    }

    static double? PickCpuLoad(IEnumerable<ISensor> sensors)
    {
        var candidates = sensors
            .Where(s => s.SensorType == SensorType.Load && s.Value.HasValue && s.Value >= 0 && s.Value <= 100)
            .Select(s => new { s.Name, Value = Valid(s.Value) })
            .Where(x => x.Value.HasValue)
            .ToList();

        var total = candidates.FirstOrDefault(x =>
            x.Name.Contains("Total", StringComparison.OrdinalIgnoreCase) ||
            x.Name.Contains("Overall", StringComparison.OrdinalIgnoreCase));
        if (total is not null) return total.Value;

        var cores = candidates
            .Where(x => x.Name.Contains("Core", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (cores.Count > 0) return cores.Average(x => x.Value!.Value);

        return candidates.FirstOrDefault()?.Value;
    }

    static double? PickGpuLoad(IEnumerable<ISensor> sensors)
    {
        var candidates = sensors
            .Where(s => s.SensorType == SensorType.Load && s.Value.HasValue && s.Value >= 0 && s.Value <= 100)
            .Select(s => new { s.Name, Value = Valid(s.Value) })
            .Where(x => x.Value.HasValue)
            .OrderByDescending(x =>
                x.Name.Contains("GPU Core", StringComparison.OrdinalIgnoreCase) ? 100 :
                x.Name.Contains("GPU Usage", StringComparison.OrdinalIgnoreCase) ? 95 :
                x.Name.Contains("D3D", StringComparison.OrdinalIgnoreCase) ? 90 :
                x.Name.Equals("GPU", StringComparison.OrdinalIgnoreCase) ? 85 :
                x.Name.Contains("GPU", StringComparison.OrdinalIgnoreCase) ? 60 :
                x.Name.Contains("3D", StringComparison.OrdinalIgnoreCase) ? 50 : 0)
            .ThenByDescending(x => x.Value)
            .ToList();
        return candidates.FirstOrDefault()?.Value;
    }

    static double? PickData(IEnumerable<ISensor> sensors, params string[] names)
    {
        foreach (var n in names)
        {
            var sensor = sensors.FirstOrDefault(s => s.Name.Contains(n, StringComparison.OrdinalIgnoreCase) && s.Value.HasValue);
            if (sensor?.Value is float value && !float.IsNaN(value) && !float.IsInfinity(value)) return value;
        }
        return null;
    }

    static long? Megabytes(double? value)
    {
        if (value is null || value < 0 || double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return null;
        return (long)Math.Round(value.Value * 1024 * 1024);
    }

    // Direct AMD SMU read through LibreHardwareMonitor's embedded PawnIO.
    // This intentionally supports only the exact Ryzen 5 5600X / Vermeer PM table
    // version validated for the Atlas target. Unknown layouts fail closed.
    static (double? temperature, string? source, string? pmVersion) TryReadRyzen5600XSmU()
    {
        if (!OperatingSystem.IsWindows()) return (null, null, null);

        object? smu = null;
        try
        {
            var smuType = Type.GetType("LibreHardwareMonitor.PawnIo.RyzenSmu, LibreHardwareMonitorLib", throwOnError: false);
            if (smuType is null) return (null, null, null);

            smu = Activator.CreateInstance(smuType);
            if (smu is null) return (null, null, null);

            var resolve = smuType.GetMethod("ResolvePmTable", BindingFlags.Public | BindingFlags.Instance);
            var update = smuType.GetMethod("UpdatePmTable", BindingFlags.Public | BindingFlags.Instance);
            var read = smuType.GetMethod("ReadPmTable", BindingFlags.Public | BindingFlags.Instance);
            if (resolve is null || update is null || read is null) return (null, null, null);

            var args = new object?[] { 0u, 0u };
            resolve.Invoke(smu, args);
            var version = Convert.ToUInt32(args[0]);
            var pmVersion = $"0x{version:X8}";

            // Vermeer 0x380905: 0x5D0 bytes = 372 float32 values.
            // Do not read/label another PM-table version with these offsets.
            if (version != 0x00380905u) return (null, "AMD SMU (PM table não suportada)", pmVersion);

            update.Invoke(smu, null);
            var raw = read.Invoke(smu, new object[] { (0x5D0 + 7) / 8 });
            if (raw is not long[] words || words.Length == 0) return (null, "AMD SMU (sem dados)", pmVersion);

            var table = new float[0x5D0 / 4];
            Buffer.BlockCopy(words, 0, table, 0, Math.Min(words.Length * sizeof(long), 0x5D0));

            // For PM table 0x380905, d[5] (offset 0x14) is the package
            // temperature value in degrees Celsius in the validated telemetry
            // layout used for Vermeer. Reject implausible values rather than guess.
            var packageTemperature = table[5];
            if (float.IsNaN(packageTemperature) || float.IsInfinity(packageTemperature) || packageTemperature < 0 || packageTemperature > 125)
                return (null, "AMD SMU (valor inválido)", pmVersion);

            return (packageTemperature, "AMD SMU PMT 0x380905 d[5] (Package)", pmVersion);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Atlas AMD SMU read failed: {ex.GetBaseException().Message}");
            return (null, "AMD SMU (falha)", null);
        }
        finally
        {
            try
            {
                if (smu is not null)
                    smu.GetType().GetMethod("Close", BindingFlags.Public | BindingFlags.Instance)?.Invoke(smu, null);
            }
            catch { }
        }
    }

    static void Main()
    {
        Console.Error.WriteLine("Atlas LibreHardwareMonitor bridge starting");
        var computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
            IsNetworkEnabled = true,
            IsStorageEnabled = true,
            IsPowerMonitorEnabled = true
        };

        try { computer.Open(); }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Atlas LHM open failed: {ex.Message}");
            return;
        }

        var visitor = new UpdateVisitor();
        var elevated = IsElevated();
        Console.Error.WriteLine(elevated
            ? "Atlas bridge: executando como administrador"
            : "Atlas bridge: SEM privilegio de administrador (sensores da CPU podem ficar indisponiveis)");
        try
        {
            while (true)
            {
                visitor.VisitComputer(computer);
                var snapshot = new Snapshot { Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Elevated = elevated };

                foreach (var hardware in computer.Hardware)
                    Collect(hardware, snapshot);

                var cpuHardware = computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
                if (cpuHardware?.Name.Contains("Ryzen 5 5600X", StringComparison.OrdinalIgnoreCase) == true
                    && DateTime.UtcNow >= smuRetryAt)
                {
                    var smu = TryReadRyzen5600XSmU();
                    if (smu.temperature is not null)
                    {
                        snapshot.Cpu.Temperature = smu.temperature;
                        snapshot.Cpu.TemperatureSource = smu.source;
                    }
                    else
                    {
                        smuRetryAt = DateTime.UtcNow.AddSeconds(30);
                    }
                    snapshot.Cpu.SmuPmTableVersion = smu.pmVersion;
                }

                Console.WriteLine(JsonSerializer.Serialize(snapshot, JsonOptions));
                Console.Out.Flush();
                Thread.Sleep(1000);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Atlas LHM bridge stopped: {ex.Message}");
        }
        finally
        {
            try { computer.Close(); } catch { }
        }
    }

    static void CollectSensorsRecursive(IHardware hardware, List<ISensor> sensors)
    {
        sensors.AddRange(hardware.Sensors);
        foreach (var child in hardware.SubHardware) CollectSensorsRecursive(child, sensors);
    }

    static void Collect(IHardware hardware, Snapshot snapshot)
    {
        var allSensors = new List<ISensor>();
        CollectSensorsRecursive(hardware, allSensors);
        var type = hardware.HardwareType;

        if (type == HardwareType.Cpu)
        {
            snapshot.Cpu.Load ??= PickCpuLoad(allSensors);
            if (snapshot.Cpu.Temperature is null)
            {
                snapshot.Cpu.Temperature = PickTemperature(allSensors);
                if (snapshot.Cpu.Temperature is not null) snapshot.Cpu.TemperatureSource = "LibreHardwareMonitor sensor";
            }
        }
        else if (type == HardwareType.GpuNvidia || type == HardwareType.GpuAmd || type == HardwareType.GpuIntel)
        {
            var gpu = new GpuData { Name = hardware.Name };
            gpu.Load = PickGpuLoad(allSensors);
            gpu.Temperature = PickTemperature(allSensors);
            gpu.Hotspot = PickTemperature(allSensors, hotspot: true);
            gpu.ClockMHz = PickData(allSensors, "GPU Core", "Core Clock", "GPU Clock", "Core");

            var used = PickData(allSensors, "GPU Memory Used", "Memory Used", "D3D Memory Dedicated");
            var total = PickData(allSensors, "GPU Memory Total", "Memory Total", "D3D Memory Dedicated Limit");
            gpu.MemoryUsedBytes = Megabytes(used);
            gpu.MemoryTotalBytes = Megabytes(total);
            snapshot.Gpus.Add(gpu);
        }
        else if (type == HardwareType.Storage)
        {
            var disk = new StorageData { Name = hardware.Name };
            var read = PickData(allSensors, "Read Rate", "Read Throughput", "Read Speed");
            var write = PickData(allSensors, "Write Rate", "Write Throughput", "Write Speed");
            disk.ReadBytesPerSec = read;
            disk.WriteBytesPerSec = write;
            disk.BusyPercent = PickLoad(allSensors);
            disk.Temperature = PickTemperature(allSensors);
            foreach (var s in allSensors)
            {
                if (s.Value is null || s.SensorType != SensorType.Level) continue;
                var n = s.Name ?? "";
                if (n.Contains("Remaining Life", StringComparison.OrdinalIgnoreCase)) disk.RemainingLifePercent = s.Value;
                else if (n.Contains("Percentage Used", StringComparison.OrdinalIgnoreCase)) disk.PercentUsed = s.Value;
                else if (n.Contains("Available Spare", StringComparison.OrdinalIgnoreCase)
                         && !n.Contains("Threshold", StringComparison.OrdinalIgnoreCase)) disk.AvailableSparePercent = s.Value;
            }
            snapshot.Storage.Add(disk);
        }

        foreach (var child in hardware.SubHardware) Collect(child, snapshot);
    }
}
