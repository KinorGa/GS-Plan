namespace GsPlan.Core.Stats;

public static class ArtifactModel
{
    public static readonly string[] SlotKeys = ["flower", "plume", "sands", "goblet", "circlet"];

    public static readonly string[] DmgElements =
        ["pyro", "hydro", "cryo", "electro", "anemo", "geo", "dendro"];

    public static readonly HashSet<string> ElementOfDmgKey =
        new(DmgElements.Select(element => element + "Dmg"), StringComparer.Ordinal);

    public static readonly HashSet<string> SubStats = new(
        [
            "hp", "atk", "def",
            "hpPct", "atkPct", "defPct",
            "em", "er", "critRate", "critDmg",
        ],
        StringComparer.Ordinal);

    public const int ArtifactLevelMax = 20;

    public static double? MainStatValue(string stat, double level)
        => ArtifactCurves.CurveValue(stat, level);
}
