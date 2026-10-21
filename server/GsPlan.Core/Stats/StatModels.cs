using System.Text.Json.Serialization;

namespace GsPlan.Core.Stats;

public sealed class CharacterBaseStats
{
    public double Level { get; init; }
    public double Hp { get; init; }
    public double Atk { get; init; }
    public double Def { get; init; }
    public string? AscensionName { get; init; }
    public double AscensionValue { get; init; }
    public Dictionary<string, double>? Innate { get; init; }
    public List<NamedValue> Extras { get; init; } = [];
}

public sealed class WeaponStats
{
    public double Level { get; init; }
    public int MaxLevel { get; init; }
    public double Atk { get; init; }
    public string? SubName { get; init; }
    public double SubValue { get; init; }
    public string? SubProp { get; init; }
}

public sealed class NamedValue
{
    public string Name { get; init; } = string.Empty;
    public double Value { get; init; }
}

public sealed class PanelNote
{
    public string Kind { get; init; } = string.Empty;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Name { get; init; }
}

public sealed class ArtifactPiece
{
    public string? SetId { get; set; }
    public string? MainStat { get; set; }
    public double? Level { get; set; }
    public List<ArtifactSubStat>? SubStats { get; set; }
}

public sealed class ArtifactSubStat
{
    public string? Key { get; set; }
    public System.Text.Json.JsonElement Value { get; set; }
}

public sealed class DerivePanelInput
{
    public string? CharId { get; set; }
    public System.Text.Json.JsonElement? Detail { get; set; }
    public double Level { get; set; } = 90;
    public string? Element { get; set; }
    public string? WeaponId { get; set; }
    public System.Text.Json.JsonElement? Weapon { get; set; }
    public Dictionary<string, ArtifactPiece>? Artifacts { get; set; }

    /// <summary>Use stats-compact.json. False reproduces the rounded detail-table fallback.</summary>
    public bool UseStats { get; set; } = true;
}

public sealed class DerivedPanel
{
    public Dictionary<string, double> Values { get; init; } = new();
    public List<PanelNote> Notes { get; init; } = [];
    public CharacterBaseStats? Base { get; init; }
    public bool Precise { get; init; }
}
