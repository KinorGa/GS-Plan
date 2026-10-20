using System.Text.Json;
using GsPlan.Core.Stats;

namespace GsPlan.Core.Axis;

/// <summary>Server-side data the axis needs but the browser should not upload.</summary>
public sealed class AxisComputationData
{
    public IReadOnlyDictionary<string, AxisTeamUnit> TeamById { get; init; } =
        new Dictionary<string, AxisTeamUnit>(StringComparer.Ordinal);
    public Func<string, JsonElement?> DetailFor { get; init; } = _ => null;
    public Func<string, JsonElement?> WeaponFor { get; init; } = _ => null;
    public JsonElement? TalentDamage { get; init; }
    public StatsCompact? Stats { get; init; }
}

public sealed class AxisPanelState
{
    public AxisTeamUnit? Unit { get; init; }
    public bool HasDetail { get; init; }
    public Dictionary<string, double> Panel { get; init; } = new(StringComparer.Ordinal);
}

/// <summary>Per-axis caches and closed formula scopes.</summary>
public sealed class AxisContext
{
    private readonly AxisComputationData _data;
    private readonly Dictionary<string, AxisPanelState> _panels = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<DamageSource>> _sources = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IReadOnlyDictionary<string, double>> _scopes =
        new(StringComparer.Ordinal);

    public AxisContext(AxisComputationData data)
    {
        _data = data;
        foreach (var unit in data.TeamById.Values)
        {
            if (string.IsNullOrEmpty(unit.Id)) continue;
            _scopes[unit.Id] = BuildScope(unit);
        }
    }

    public IReadOnlyDictionary<string, double>? ScopeForOwner(AxisDrop drop)
    {
        var id = drop.Source?.Owner?.Id;
        return id is not null && _scopes.TryGetValue(id, out var scope) ? scope : null;
    }

    public AxisPanelState PanelForEntry(AxisEntry entry)
    {
        if (string.IsNullOrEmpty(entry.CharId)
            || !_data.TeamById.TryGetValue(entry.CharId, out var unit))
        {
            return new AxisPanelState { Panel = AxisPanelStats.DefaultStats() };
        }
        return PanelForUnit(unit, entry.StatOverrides);
    }

    public List<DamageSource> SourcesForEntry(AxisEntry entry)
    {
        if (string.IsNullOrEmpty(entry.CharId)
            || !_data.TeamById.TryGetValue(entry.CharId, out var unit))
        {
            return [];
        }
        if (_sources.TryGetValue(entry.CharId, out var cached)) return cached;
        var detail = _data.DetailFor(entry.CharId);
        if (detail is null)
        {
            _sources[entry.CharId] = [];
            return [];
        }
        var sources = CharacterSources.BuildSources(
            detail.Value,
            unit.Element,
            _data.TalentDamage,
            entry.CharId,
            unit.Talents);
        _sources[entry.CharId] = sources;
        return sources;
    }

    private AxisPanelState PanelForUnit(
        AxisTeamUnit unit,
        IReadOnlyDictionary<string, double>? overrides)
    {
        var key = unit.Id ?? string.Empty;
        if (_panels.TryGetValue(key, out var cached))
        {
            return WithOverrides(cached, overrides);
        }

        var detail = _data.DetailFor(key);
        if (detail is null)
        {
            return new AxisPanelState
            {
                Unit = unit,
                HasDetail = false,
                Panel = AxisPanelStats.DefaultStats(),
            };
        }

        var derived = StatDeriver.DerivePanel(new DerivePanelInput
        {
            CharId = unit.Id,
            Detail = detail,
            Level = unit.Level,
            Element = unit.Element,
            WeaponId = unit.WeaponId,
            Weapon = string.IsNullOrEmpty(unit.WeaponId) ? null : _data.WeaponFor(unit.WeaponId),
            Artifacts = unit.Artifacts,
            UseStats = true,
        }, _data.Stats).Values;

        var panel = AxisPanelStats.DefaultStats();
        foreach (var (panelKey, value) in derived) panel[panelKey] = value;
        var state = new AxisPanelState { Unit = unit, HasDetail = true, Panel = panel };
        _panels[key] = state;
        return WithOverrides(state, overrides);
    }

    private static AxisPanelState WithOverrides(
        AxisPanelState state,
        IReadOnlyDictionary<string, double>? overrides)
    {
        if (overrides is null || overrides.Count == 0) return state;
        var panel = new Dictionary<string, double>(state.Panel, StringComparer.Ordinal);
        foreach (var (key, value) in overrides) panel[key] = value;
        return new AxisPanelState
        {
            Unit = state.Unit,
            HasDetail = state.HasDetail,
            Panel = panel,
        };
    }

    private IReadOnlyDictionary<string, double> BuildScope(AxisTeamUnit unit)
    {
        var state = PanelForUnit(unit, null);
        var panel = state.Panel;
        var scope = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var (key, symbol) in AxisPanelStats.PanelSymbols)
        {
            scope[symbol] = panel.TryGetValue(key, out var value) ? value : 0;
        }
        scope["总生命值"] = Get(panel, "hp") * (1 + Get(panel, "hpPct") / 100) + Get(panel, "flatHp");
        scope["总攻击力"] = Get(panel, "atk") * (1 + Get(panel, "atkPct") / 100) + Get(panel, "flatAtk");
        scope["总防御力"] = Get(panel, "def") * (1 + Get(panel, "defPct") / 100) + Get(panel, "flatDef");
        scope["等级"] = unit.Level;
        scope["命座"] = unit.Constellation;
        scope["普通攻击等级"] = Talent(unit, "normal");
        scope["元素战技等级"] = Talent(unit, "skill");
        scope["元素爆发等级"] = Talent(unit, "burst");
        scope["精炼"] = unit.Refine;
        scope["稀有度"] = unit.QualityType switch
        {
            "QUALITY_ORANGE" => 5,
            "QUALITY_PURPLE" => 4,
            _ => 0,
        };
        return scope;
    }

    private static double Talent(AxisTeamUnit unit, string key)
        => unit.Talents is not null && unit.Talents.TryGetValue(key, out var value) ? value : 0;

    private static double Get(IReadOnlyDictionary<string, double> panel, string key)
        => panel.TryGetValue(key, out var value) ? value : 0;
}
