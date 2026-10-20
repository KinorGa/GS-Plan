using System.Text.Json.Serialization;
using GsPlan.Core.Axis;

namespace GsPlan.Core.Artifacts;

/// <summary>
/// A structured artifact-optimisation request. It carries the same expression
/// coefficients the browser used to write into a problem file, plus the baseline
/// panel, the current build as a comparison row, and the shape of each piece.
/// </summary>
public sealed class ArtifactOptimizeRequest
{
    public MergedCoefficients? Coeffs { get; set; }
    public ArtifactPanel? Panel { get; set; } = new();
    public ArtifactRef? Ref { get; set; }
    public List<ArtifactPieceSpec>? Pieces { get; set; } = [];
    public double HitScale { get; set; } = 0.8;
    public int Rarity { get; set; } = 5;
}

/// <summary>The panel the optimiser starts from, with every substat removed.</summary>
public sealed class ArtifactPanel
{
    public double Atk { get; set; }
    public double AtkPct { get; set; }
    public double FlatAtk { get; set; }
    public double CritRate { get; set; }
    public double CritDmg { get; set; }
    public double AnemoDmg { get; set; }
    public double PyroDmg { get; set; }
    public double DmgBonus { get; set; }
    public double Em { get; set; }
    public double Hp { get; set; }
    public double HpPct { get; set; }
    public double FlatHp { get; set; }
    public double Def { get; set; }
    public double DefPct { get; set; }
    public double FlatDef { get; set; }
}

/// <summary>The current build's evaluation panel, emitted as the comparison row.</summary>
public sealed class ArtifactRef
{
    [JsonPropertyName("A")]
    public double A { get; set; }
    [JsonPropertyName("H")]
    public double H { get; set; }
    [JsonPropertyName("D")]
    public double D { get; set; }
    [JsonPropertyName("M")]
    public double M { get; set; }
    [JsonPropertyName("C")]
    public double C { get; set; }
    [JsonPropertyName("R")]
    public double R { get; set; }
    [JsonPropertyName("E")]
    public double E { get; set; }
}

/// <summary>One piece's legal lines and roll budget.</summary>
public sealed class ArtifactPieceSpec
{
    public string Slot { get; set; } = string.Empty;
    public int Lines { get; set; }
    public int Rolls { get; set; }
    public int MaxPerLine { get; set; }
    public List<ArtifactAllow>? Allows { get; set; } = [];
}

/// <summary>State 1 means "may sit here"; state 2 means "must".</summary>
public sealed class ArtifactAllow
{
    public string Key { get; set; } = string.Empty;
    public int State { get; set; }
}

public sealed class ArtifactParseRequest
{
    public string? Csv { get; set; }
}

public sealed class ArtifactOptimizeResult
{
    public string Problem { get; init; } = string.Empty;
    public List<string> Stats { get; init; } = [];
    public List<ArtifactOptimizeRow> Rows { get; init; } = [];
    public double ElapsedMs { get; init; }
}

public sealed class ArtifactOptimizeParsed
{
    public List<string> Stats { get; init; } = [];
    public List<ArtifactOptimizeRow> Rows { get; init; } = [];
}

public sealed class ArtifactOptimizeRow
{
    public Dictionary<string, double> Hits { get; init; } = new(StringComparer.Ordinal);
    public bool HasHits { get; init; }
    public double Total { get; init; }
    [JsonPropertyName("A")]
    public double A { get; init; }
    [JsonPropertyName("H")]
    public double H { get; init; }
    [JsonPropertyName("D")]
    public double D { get; init; }
    [JsonPropertyName("M")]
    public double M { get; init; }
    [JsonPropertyName("C")]
    public double C { get; init; }
    [JsonPropertyName("R")]
    public double R { get; init; }
    [JsonPropertyName("E")]
    public double E { get; init; }
    public double Never { get; init; }
    public double Crit { get; init; }
    public double Avg { get; init; }
    public bool IsCurrent { get; init; }
}
