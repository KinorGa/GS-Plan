namespace GsPlan.Core.Damage;

/// <summary>
/// The pure damage formula shared by every core surface. Ported branch-for-branch
/// from <c>src/lib/damage.js</c>; tests compare the two implementations directly.
/// </summary>
public static class DamageCalculator
{
    // REF: docs/REACTIONS.md#transformative
    public static readonly double[] ReactionLevelBaseTable =
    [
        17.165606, 18.535048, 19.904854, 21.274902, 22.6454,
        24.649612, 26.640642, 28.868587, 31.36768, 34.143345,
        37.201, 40.66, 44.446667, 48.56352, 53.74848,
        59.081898, 64.420044, 69.72446, 75.12314, 80.58478,
        86.11203, 91.70374, 97.24463, 102.812645, 108.40956,
        113.20169, 118.102905, 122.97932, 129.72733, 136.29291,
        142.67085, 149.02902, 155.41699, 161.8255, 169.10631,
        176.51808, 184.07274, 191.70952, 199.55692, 207.38205,
        215.3989, 224.16566, 233.50217, 243.35057, 256.06308,
        268.5435, 281.52606, 295.01364, 309.0672, 323.6016,
        336.75754, 350.5303, 364.4827, 378.61917, 398.6004,
        416.39825, 434.387, 452.95105, 472.60623, 492.8849,
        513.56854, 539.1032, 565.51056, 592.53876, 624.4434,
        651.47015, 679.4968, 707.79407, 736.67145, 765.64026,
        794.7734, 824.67737, 851.1578, 877.74207, 914.2291,
        946.74677, 979.4114, 1011.223, 1044.7917, 1077.4437,
        1109.9976, 1142.9766, 1176.3695, 1210.1844, 1253.8357,
        1288.9528, 1325.4841, 1363.4569, 1405.0974, 1446.8535,
    ];

    private static readonly Dictionary<string, string> BasisAliases = new(StringComparer.Ordinal)
    {
        ["atk"] = "atk",
        ["attack"] = "atk",
        ["攻击力"] = "atk",
        ["hp"] = "hp",
        ["health"] = "hp",
        ["生命值"] = "hp",
        ["def"] = "def",
        ["defense"] = "def",
        ["防御力"] = "def",
        ["em"] = "em",
        ["mastery"] = "em",
        ["元素精通"] = "em",
    };

    public static double ReactionLevelBase(double level)
    {
        var value = level == 0 || double.IsNaN(level) ? 1 : level;
        var index = (int)Math.Min(Math.Max(Math.Floor(value), 1), 90) - 1;
        return ReactionLevelBaseTable[index];
    }

    public static double TransformativeEmBonus(double em)
    {
        var value = Math.Max(0, em == 0 || double.IsNaN(em) ? 0 : em);
        return 16 * value / (value + 2000);
    }

    public static string? ReactionDamageElement(DamageReaction? reaction, string? hitElement)
    {
        if (reaction is not { Transformative: true }) return null;
        if (!string.IsNullOrEmpty(reaction.DamageElement)) return reaction.DamageElement;
        if (reaction.Key == "swirl")
        {
            var pairElement = reaction.Pair is { Length: > 1 } ? reaction.Pair[1] : null;
            return string.IsNullOrEmpty(pairElement) ? hitElement : pairElement;
        }
        return hitElement;
    }

    public static string NormaliseScalingBasis(string? value)
    {
        if (value is null) return "atk";
        var trimmed = value.Trim();
        if (BasisAliases.TryGetValue(trimmed.ToLowerInvariant(), out var basis)) return basis;
        return BasisAliases.TryGetValue(trimmed, out basis) ? basis : "atk";
    }

    public static string EntryScalingBasis(string? scalingBasis, string? stageBasis, string fallback = "atk")
        => NormaliseScalingBasis(scalingBasis ?? stageBasis ?? fallback);

    public static double DmgBonusFor(DamageStats stats, string? element)
    {
        if (element == "Physical") return stats.PhysBonus + stats.DmgBonus;
        var own = (element ?? string.Empty).ToLowerInvariant() switch
        {
            "pyro" => stats.PyroDmg,
            "hydro" => stats.HydroDmg,
            "cryo" => stats.CryoDmg,
            "electro" => stats.ElectroDmg,
            "anemo" => stats.AnemoDmg,
            "geo" => stats.GeoDmg,
            "dendro" => stats.DendroDmg,
            _ => 0,
        };
        return own + stats.DmgBonus;
    }

    public static double ResMultiplier(DamageStats stats, string? element)
    {
        var suffix = Elements.DamageTypeSuffix(element);
        var own = suffix is null
            ? 0
            : (EnemyResistance(stats, suffix) ?? 10) / 100 - ResistanceShred(stats, suffix) / 100;
        var res = own - stats.ResShred / 100;
        return res < 0 ? 1 - res / 2 : 1 - res;
    }

    public static double ComputeTotal(DamageStats stats, DamageOptions options)
        => Compute(stats, options).Total;

    public static DamageResult Compute(DamageStats stats, DamageOptions options)
    {
        ArgumentNullException.ThrowIfNull(stats);
        options ??= new DamageOptions();
        var stage = options.Stage ?? new DamageStage();
        var reaction = options.Reaction ?? new DamageReaction();

        var totalHp = stats.Hp * (1 + stats.HpPct / 100) + stats.FlatHp;
        var totalAtk = stats.Atk * (1 + stats.AtkPct / 100) + stats.FlatAtk;
        var totalDef = stats.Def * (1 + stats.DefPct / 100) + stats.FlatDef;

        var scalingBasis = NormaliseScalingBasis(options.Basis);
        var scalingValue = scalingBasis switch
        {
            "hp" => totalHp,
            "def" => totalDef,
            "em" => stats.Em,
            _ => totalAtk,
        };

        var talent = stage.Mult * options.MultZone * (1 + stage.Bonus) * (1 + stats.TalentBonus / 100);
        var baseDamage = scalingValue * talent + stats.FlatDmg;

        // REF: docs/REACTIONS.md#amplifying
        var reactionBonusPct = stats.ReactionBonus;
        var emBonus = reaction.Amp ? 2.78 * stats.Em / (stats.Em + 1400) : 0;
        var reactMult = reaction.Amp
            ? reaction.Base * (1 + emBonus + reactionBonusPct / 100)
            : 1;

        // REF: docs/REACTIONS.md#transformative
        var transformative = reaction.Transformative && reaction.Coefficient > 0;
        var reactionBase = transformative
            ? ReactionLevelBase(options.AtkLevel) * reaction.Coefficient
            : 0;
        var reactionEmBonus = transformative ? TransformativeEmBonus(stats.Em) : 0;
        var reactionTarget = transformative ? ReactionDamageElement(reaction, options.Element) : null;
        var reactionResMult = transformative ? ResMultiplier(stats, reactionTarget) : 1;
        var reactionBaseDamage = reactionBase * reactionResMult;
        var reactionPerHit = transformative
            ? reactionBaseDamage * (1 + reactionEmBonus + reactionBonusPct / 100)
            : 0;

        var cd = stats.CritDmg / 100;
        var rate = Math.Min(stats.CritRate, 100) / 100;
        var critMult = options.CritMode switch
        {
            "never" => 1,
            "crit" => 1 + cd,
            _ => 1 + rate * cd,
        };

        var defFactor = (1 - Clamp01(stats.DefShred)) * (1 - Clamp01(stats.DefIgnore));
        var defMult = (100 + options.AtkLevel)
            / (100 + options.AtkLevel + (100 + stats.EnemyLevel) * defFactor);

        var resMult = ResMultiplier(stats, options.Element);
        var bonusPct = DmgBonusFor(stats, options.Element);
        var withBonus = baseDamage * (1 + bonusPct / 100);
        var zoned = withBonus * options.ZoneMult;
        var directPerHit = zoned * reactMult * critMult * defMult * resMult;
        var perHit = directPerHit + reactionPerHit;
        var hits = stage.Hits == 0 || double.IsNaN(stage.Hits) ? 1 : stage.Hits;

        return new DamageResult
        {
            TotalHp = totalHp,
            TotalAtk = totalAtk,
            TotalDef = totalDef,
            Talent = talent,
            EmBonus = emBonus,
            ReactMult = reactMult,
            CritMult = critMult,
            DefMult = defMult,
            ResMult = resMult,
            BonusPct = bonusPct,
            WithBonus = withBonus,
            ZoneMult = options.ZoneMult,
            MultZone = options.MultZone,
            Zoned = zoned,
            DirectPerHit = directPerHit,
            ReactionBase = reactionBase,
            ReactionBaseDamage = reactionBaseDamage,
            ReactionEmBonus = reactionEmBonus,
            ReactionTarget = reactionTarget,
            ReactionResMult = reactionResMult,
            ReactionPerHit = reactionPerHit,
            ReactionTotal = reactionPerHit * hits,
            Transformative = transformative,
            PerHit = perHit,
            Total = perHit * hits,
            Er = stats.Er,
            ScalingBasis = scalingBasis,
            ScalingValue = scalingValue,
        };
    }

    private static double Clamp01(double value)
    {
        var normalised = double.IsNaN(value) ? 0 : value / 100;
        return Math.Min(Math.Max(normalised, 0), 1);
    }

    private static double? EnemyResistance(DamageStats stats, string suffix) => suffix switch
    {
        "Pyro" => stats.EnemyResPyro,
        "Hydro" => stats.EnemyResHydro,
        "Cryo" => stats.EnemyResCryo,
        "Electro" => stats.EnemyResElectro,
        "Anemo" => stats.EnemyResAnemo,
        "Geo" => stats.EnemyResGeo,
        "Dendro" => stats.EnemyResDendro,
        "Physical" => stats.EnemyResPhysical,
        _ => null,
    };

    private static double ResistanceShred(DamageStats stats, string suffix) => suffix switch
    {
        "Pyro" => stats.ResShredPyro,
        "Hydro" => stats.ResShredHydro,
        "Cryo" => stats.ResShredCryo,
        "Electro" => stats.ResShredElectro,
        "Anemo" => stats.ResShredAnemo,
        "Geo" => stats.ResShredGeo,
        "Dendro" => stats.ResShredDendro,
        "Physical" => stats.ResShredPhysical,
        _ => 0,
    };
}
