namespace GsPlan.Core.Stats;

/// <summary>
/// Request for the legal substat totals of one or more stats. Omitting
/// <see cref="Keys"/> returns every stat known at that rarity.
/// </summary>
public sealed class SubstatRollsRequest
{
    public int Rarity { get; set; } = SubstatRolls.DefaultRarity;
    public List<string>? Keys { get; set; }
}

public sealed class SubstatRollsResult
{
    public int Rarity { get; init; }
    public int MaxRolls { get; init; }
    public Dictionary<string, SubstatRollTable> Stats { get; init; } = new(StringComparer.Ordinal);
}

public sealed class SubstatRollTable
{
    public List<double> Tiers { get; init; } = [];
    public List<SubstatRollTotal> Totals { get; init; } = [];
}

/// <summary>One reachable total, with every tier multiset that can produce it.</summary>
public sealed class SubstatRollTotal
{
    public int M { get; init; }
    public double Value { get; init; }
    public List<int> RollCounts => Entries
        .Select(entry => entry.N)
        .Distinct()
        .OrderBy(value => value)
        .ToList();
    public List<SubstatRollWay> Entries { get; init; } = [];
}

public sealed class SubstatRollWay
{
    public int N { get; init; }
    public List<int> Tiers { get; init; } = [];
}
