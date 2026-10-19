namespace GsPlan.Core.Stats;

/// <summary>
/// Typed view of <c>public/data/stats-compact.json</c>.
/// The file stores factor tables rather than precomputed per-level rows:
/// value = base * curve(level) + ascensionBonus(phase).
/// </summary>
public sealed class StatsCompact
{
    public System.Text.Json.JsonElement? Source { get; set; }
    public Dictionary<string, double[]> CharCurve { get; set; } = new();
    public Dictionary<string, double[]> WeaponCurve { get; set; } = new();
    public Dictionary<string, List<Dictionary<string, double>>> CharPromote { get; set; } = new();
    public Dictionary<string, List<Dictionary<string, double>>> WeaponPromote { get; set; } = new();
    public Dictionary<string, CharacterFactor> Chars { get; set; } = new();
    public Dictionary<string, WeaponFactor> Weapons { get; set; } = new();
}

public sealed class CharacterFactor
{
    public string Promote { get; set; } = string.Empty;
    public int MaxLevel { get; set; }
    public BaseStatFactors Base { get; set; } = new();
    public CurveRefs Curve { get; set; } = new();
    public Dictionary<string, double>? Innate { get; set; }
}

public sealed class WeaponFactor
{
    public string Promote { get; set; } = string.Empty;
    public int MaxLevel { get; set; }
    public MainStatFactor Main { get; set; } = new();
    public SubStatFactor? Sub { get; set; }
}

public sealed class BaseStatFactors
{
    public double Hp { get; set; }
    public double Atk { get; set; }
    public double Def { get; set; }
}

public sealed class CurveRefs
{
    public string? Hp { get; set; }
    public string? Atk { get; set; }
    public string? Def { get; set; }
}

public sealed class MainStatFactor
{
    public string Prop { get; set; } = string.Empty;
    public double Base { get; set; }
    public string? Curve { get; set; }
}

public sealed class SubStatFactor
{
    public string Prop { get; set; } = string.Empty;
    public double Base { get; set; }
    public string? Curve { get; set; }
}
