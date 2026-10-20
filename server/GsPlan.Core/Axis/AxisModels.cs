namespace GsPlan.Core.Axis;

/// <summary>
/// The whole-axis request. The browser sends the axis and each unit's build;
/// character detail, weapons and curated talent rows stay server-side.
/// </summary>
public sealed class AxisRequest
{
    public string Lang { get; set; } = "chs";
    public List<AxisEntry> Entries { get; set; } = [];
    public List<AxisTeamUnit> Team { get; set; } = [];
}

public sealed class AxisTeamUnit
{
    public string? Id { get; set; }
    public string? UnitId { get; set; }
    public double Level { get; set; } = 90;
    public string? Element { get; set; }
    public string? WeaponId { get; set; }
    public string? QualityType { get; set; }
    public int Constellation { get; set; }
    public int Refine { get; set; } = 1;
    public Dictionary<string, int>? Talents { get; set; }
    public Dictionary<string, GsPlan.Core.Stats.ArtifactPiece>? Artifacts { get; set; }
}

public sealed class AxisEntry
{
    public string Id { get; set; } = string.Empty;
    public string? Kind { get; set; }
    public string? CharId { get; set; }
    public AxisSummary? Summary { get; set; }
    public AxisPicked? Picked { get; set; }
    public Dictionary<string, double>? StatOverrides { get; set; }
    public string? Element { get; set; }
    public string? ReactionKey { get; set; }
    public string? CritMode { get; set; }
    public string? ScalingBasis { get; set; }
    public AxisScaling? Scaling { get; set; }
    public int? PartIndex { get; set; }
    public List<AxisEntry>? Children { get; set; }
    public List<AxisDrop>? Drops { get; set; }
}

public sealed class AxisSummary
{
    public string? SourceKey { get; set; }
    public int? StageIndex { get; set; }
    public int? PartIndex { get; set; }
    public string? Element { get; set; }
    public string? ReactionKey { get; set; }
    public AxisStage? Stage { get; set; }
}

public sealed class AxisPicked
{
    public string? SourceKey { get; set; }
    public int? StageIndex { get; set; }
}

public sealed class AxisStage
{
    public string? Basis { get; set; }
}

public sealed class AxisScaling
{
    public double? Mult { get; set; }
    public double? Hits { get; set; }
}

public sealed class AxisDrop
{
    public AxisSource? Source { get; set; }
    public List<AxisBuff>? Buffs { get; set; }
}

public sealed class AxisSource
{
    public AxisOwner? Owner { get; set; }
}

public sealed class AxisOwner
{
    public string? Id { get; set; }
}

public sealed class AxisBuff
{
    public string? Key { get; set; }
    public System.Text.Json.JsonElement Value { get; set; }
}

public sealed class AxisEntryResult
{
    public bool? Loop { get; set; }
    public List<AxisEntryResult>? Children { get; set; }
    public List<AxisPartResult>? Parts { get; set; }
    public double PerHit { get; set; }
    public double Total { get; set; }
    public double Hits { get; set; }
}

public sealed class AxisPartResult
{
    public int PartIndex { get; set; }
    public string? Element { get; set; }
    public double PerHit { get; set; }
    public double Total { get; set; }
    public double Hits { get; set; }
    public double Mult { get; set; }
    public string ScalingBasis { get; set; } = "atk";
}

public sealed class AxisResult
{
    public Dictionary<string, AxisEntryResult> ById { get; init; } = new(StringComparer.Ordinal);
    public double Total { get; init; }
    public double PerHit { get; init; }
    public int Computed { get; init; }
    public int Entries { get; init; }
}
