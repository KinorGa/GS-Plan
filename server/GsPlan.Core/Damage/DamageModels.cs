namespace GsPlan.Core.Damage;

/// <summary>
/// The effective stat panel read by <see cref="DamageCalculator"/>.
/// HP/ATK/DEF are the bases a percentage multiplies; flat additions sit beside
/// them. CRIT Rate, CRIT DMG and Energy Recharge are totals and already include
/// the game's base values.
/// </summary>
public sealed class DamageStats
{
    public double Hp { get; set; }
    public double Atk { get; set; }
    public double Def { get; set; }
    public double HpPct { get; set; }
    public double AtkPct { get; set; }
    public double DefPct { get; set; }
    public double FlatHp { get; set; }
    public double FlatAtk { get; set; }
    public double FlatDef { get; set; }
    public double Em { get; set; }
    public double CritRate { get; set; }
    public double CritDmg { get; set; }
    public double Er { get; set; }
    public double DmgBonus { get; set; }
    public double PhysBonus { get; set; }
    public double PyroDmg { get; set; }
    public double HydroDmg { get; set; }
    public double CryoDmg { get; set; }
    public double ElectroDmg { get; set; }
    public double AnemoDmg { get; set; }
    public double GeoDmg { get; set; }
    public double DendroDmg { get; set; }
    public double ReactionBonus { get; set; }
    public double DefShred { get; set; }
    public double DefIgnore { get; set; }
    public double EnemyLevel { get; set; }
    public double TalentBonus { get; set; }
    public double FlatDmg { get; set; }
    public double ResShred { get; set; }

    // Null means "the enemy has the standard 10% resistance". An explicit zero
    // is preserved and means zero resistance, which is why these are nullable.
    public double? EnemyResPyro { get; set; }
    public double? EnemyResHydro { get; set; }
    public double? EnemyResCryo { get; set; }
    public double? EnemyResElectro { get; set; }
    public double? EnemyResAnemo { get; set; }
    public double? EnemyResGeo { get; set; }
    public double? EnemyResDendro { get; set; }
    public double? EnemyResPhysical { get; set; }

    public double ResShredPyro { get; set; }
    public double ResShredHydro { get; set; }
    public double ResShredCryo { get; set; }
    public double ResShredElectro { get; set; }
    public double ResShredAnemo { get; set; }
    public double ResShredGeo { get; set; }
    public double ResShredDendro { get; set; }
    public double ResShredPhysical { get; set; }
}

public sealed class DamageStage
{
    public double Mult { get; set; }
    public double Hits { get; set; }
    public double Bonus { get; set; }
}

public sealed class DamageReaction
{
    public bool Amp { get; set; }
    public double Base { get; set; }
    public bool Transformative { get; set; }
    public double Coefficient { get; set; }
    public string? Key { get; set; }
    public string[]? Pair { get; set; }
    public string? DamageElement { get; set; }
}

public sealed class DamageOptions
{
    public DamageStage Stage { get; set; } = new();
    public DamageReaction Reaction { get; set; } = new();
    public string? Element { get; set; }
    public string? CritMode { get; set; }
    public double AtkLevel { get; set; } = 90;
    public double ZoneMult { get; set; } = 1;
    public double MultZone { get; set; } = 1;
    public string? Basis { get; set; } = "atk";
}

public sealed class DamageResult
{
    public double TotalHp { get; init; }
    public double TotalAtk { get; init; }
    public double TotalDef { get; init; }
    public double Talent { get; init; }
    public double EmBonus { get; init; }
    public double ReactMult { get; init; }
    public double CritMult { get; init; }
    public double DefMult { get; init; }
    public double ResMult { get; init; }
    public double BonusPct { get; init; }
    public double WithBonus { get; init; }
    public double ZoneMult { get; init; }
    public double MultZone { get; init; }
    public double Zoned { get; init; }
    public double DirectPerHit { get; init; }
    public double ReactionBase { get; init; }
    public double ReactionBaseDamage { get; init; }
    public double ReactionEmBonus { get; init; }
    public string? ReactionTarget { get; init; }
    public double ReactionResMult { get; init; }
    public double ReactionPerHit { get; init; }
    public double ReactionTotal { get; init; }
    public bool Transformative { get; init; }
    public double PerHit { get; init; }
    public double Total { get; init; }
    public double Er { get; init; }
    public string ScalingBasis { get; init; } = "atk";
    public double ScalingValue { get; init; }
}
