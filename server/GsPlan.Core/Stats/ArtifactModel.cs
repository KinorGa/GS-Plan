namespace GsPlan.Core.Stats;

public static class ArtifactModel
{
    public static readonly string[] SlotKeys = ["flower", "plume", "sands", "goblet", "circlet"];

    public static readonly string[] DmgElements =
        ["pyro", "hydro", "cryo", "electro", "anemo", "geo", "dendro"];

    public static readonly HashSet<string> ElementOfDmgKey =
        new(DmgElements.Select(element => element + "Dmg"), StringComparer.Ordinal);

    /// <summary>The substat order the optimizer's hit rows and CSV columns use.</summary>
    public static readonly string[] SubStatOrder =
    [
        "hp", "atk", "def",
        "hpPct", "atkPct", "defPct",
        "em", "er", "critRate", "critDmg",
    ];

    public static readonly HashSet<string> SubStats =
        new(SubStatOrder, StringComparer.Ordinal);

    public const int ArtifactLevelMax = 20;

    public static double? MainStatValue(string stat, double level)
        => ArtifactCurves.CurveValue(stat, level);
}
