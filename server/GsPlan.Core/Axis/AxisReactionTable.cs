using GsPlan.Core.Damage;

namespace GsPlan.Core.Axis;

/// <summary>Reaction rows shared with the damage card; REF: docs/REACTIONS.md.</summary>
public static class AxisReactionTable
{
    public static DamageReaction ByKey(string? key) => key switch
    {
        "vaporize" => new DamageReaction { Key = "vaporize", Amp = true, Base = 2.0 },
        "vaporize_rev" => new DamageReaction { Key = "vaporize_rev", Amp = true, Base = 1.5 },
        "melt" => new DamageReaction { Key = "melt", Amp = true, Base = 2.0 },
        "melt_rev" => new DamageReaction { Key = "melt_rev", Amp = true, Base = 1.5 },
        "superconduct" => new DamageReaction
        {
            Key = "superconduct", Transformative = true, Coefficient = 0.5,
            DamageElement = "Cryo", Pair = ["cryo", "electro"],
        },
        "swirl" => new DamageReaction
        {
            Key = "swirl", Transformative = true, Coefficient = 0.6,
            Pair = ["anemo", "pyro"],
        },
        "electrocharged" => new DamageReaction
        {
            Key = "electrocharged", Transformative = true, Coefficient = 1.2,
            DamageElement = "Electro", Pair = ["hydro", "electro"],
        },
        "frozen" => new DamageReaction
        {
            Key = "frozen", Transformative = true, Pair = ["cryo", "hydro"],
        },
        "overloaded" => new DamageReaction
        {
            Key = "overloaded", Transformative = true, Coefficient = 2.0,
            DamageElement = "Pyro", Pair = ["pyro", "electro"],
        },
        "burning" => new DamageReaction
        {
            Key = "burning", Transformative = true, Coefficient = 0.25,
            DamageElement = "Pyro", Pair = ["pyro", "dendro"],
        },
        "quicken" => new DamageReaction
        {
            Key = "quicken", Transformative = true, Pair = ["dendro", "electro"],
        },
        "bloom" => new DamageReaction
        {
            Key = "bloom", Transformative = true, Coefficient = 2.0,
            DamageElement = "Dendro", Pair = ["dendro", "hydro"],
        },
        "crystallize" => new DamageReaction
        {
            Key = "crystallize", Transformative = true, Pair = ["geo", "pyro"],
        },
        _ => new DamageReaction { Key = "none", Base = 1 },
    };
}
