using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Core.Stats;

namespace GsPlan.Api.Services;

/// <summary>Lazily loads and caches the packed stat-factor catalogue.</summary>
public sealed class StatsCatalog
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ResolvedPaths _paths;
    private readonly object _gate = new();
    private StatsCompact? _stats;

    public StatsCatalog(ResolvedPaths paths)
    {
        _paths = paths;
    }

    public StatsCompact Get()
    {
        if (_stats is not null) return _stats;
        lock (_gate)
        {
            if (_stats is not null) return _stats;
            if (!File.Exists(_paths.StatsFile))
            {
                throw new FileNotFoundException("stats-compact.json not found", _paths.StatsFile);
            }

            using var stream = File.OpenRead(_paths.StatsFile);
            _stats = JsonSerializer.Deserialize<StatsCompact>(stream, JsonOptions)
                ?? throw new InvalidDataException("stats-compact.json is empty");
            return _stats;
        }
    }
}
