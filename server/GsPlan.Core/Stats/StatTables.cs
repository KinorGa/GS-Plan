namespace GsPlan.Core.Stats;

/// <summary>
/// Reader for the packed stat factors. See <c>src/lib/stat-tables.js</c> for the
/// source-data traps this preserves: a curve name is never inferred from a stat
/// name, and Excel percentage fractions are converted to display units here.
/// </summary>
public static class StatTables
{
    private static readonly int[] PhaseUnlocks = [20, 40, 50, 60, 70, 80, 90];

    private static readonly Dictionary<string, AscensionProp> AscensionProps = new(StringComparer.Ordinal)
    {
        ["FIGHT_PROP_CRITICAL"] = new("CRIT Rate%", true),
        ["FIGHT_PROP_CRITICAL_HURT"] = new("CRIT DMG%", true),
        ["FIGHT_PROP_ATTACK_PERCENT"] = new("ATK%", true),
        ["FIGHT_PROP_HP_PERCENT"] = new("HP%", true),
        ["FIGHT_PROP_DEFENSE_PERCENT"] = new("DEF%", true),
        ["FIGHT_PROP_ELEMENT_MASTERY"] = new("Elemental Mastery", false),
        ["FIGHT_PROP_CHARGE_EFFICIENCY"] = new("Energy Recharge%", true),
        ["FIGHT_PROP_PHYSICAL_ADD_HURT"] = new("Physical DMG Bonus%", true),
        ["FIGHT_PROP_HEAL_ADD"] = new("Healing Bonus%", true),
        ["FIGHT_PROP_FIRE_ADD_HURT"] = new("Pyro DMG Bonus%", true),
        ["FIGHT_PROP_WATER_ADD_HURT"] = new("Hydro DMG Bonus%", true),
        ["FIGHT_PROP_ICE_ADD_HURT"] = new("Cryo DMG Bonus%", true),
        ["FIGHT_PROP_ELEC_ADD_HURT"] = new("Electro DMG Bonus%", true),
        ["FIGHT_PROP_WIND_ADD_HURT"] = new("Anemo DMG Bonus%", true),
        ["FIGHT_PROP_ROCK_ADD_HURT"] = new("Geo DMG Bonus%", true),
        ["FIGHT_PROP_GRASS_ADD_HURT"] = new("Dendro DMG Bonus%", true),
    };

    private static readonly Dictionary<string, string> BaseProps = new(StringComparer.Ordinal)
    {
        ["FIGHT_PROP_BASE_HP"] = "hp",
        ["FIGHT_PROP_BASE_ATTACK"] = "atk",
        ["FIGHT_PROP_BASE_DEFENSE"] = "def",
    };

    public static int AscensionPhase(IReadOnlyList<Dictionary<string, double>>? phases, double level)
    {
        var count = phases?.Count ?? 0;
        if (count == 0) return 0;
        var phase = 0;
        for (var i = 0; i < Math.Min(count - 1, PhaseUnlocks.Length); i++)
        {
            if (PhaseUnlocks[i] < level) phase++;
        }
        return Math.Min(phase, count - 1);
    }

    public static CharacterBaseStats? CharStatsAt(StatsCompact stats, string? charId, double level)
    {
        if (charId is null) return null;
        CharacterFactor? character = null;
        if (!stats.Chars.TryGetValue(charId, out character))
        {
            var baseKey = charId.Split('_')[0];
            stats.Chars.TryGetValue(baseKey, out character);
        }
        if (character is null) return null;

        var phases = stats.CharPromote.TryGetValue(character.Promote, out var found)
            ? found
            : [new Dictionary<string, double>()];
        var phase = AscensionPhase(phases, level);
        var bonus = phases.Count > phase ? phases[phase] : new Dictionary<string, double>();

        var hp = character.Base.Hp * CurveAt(stats.CharCurve, character.Curve.Hp, level)
            + Bonus(bonus, "FIGHT_PROP_BASE_HP");
        var atk = character.Base.Atk * CurveAt(stats.CharCurve, character.Curve.Atk, level)
            + Bonus(bonus, "FIGHT_PROP_BASE_ATTACK");
        var def = character.Base.Def * CurveAt(stats.CharCurve, character.Curve.Def, level)
            + Bonus(bonus, "FIGHT_PROP_BASE_DEFENSE");

        string? ascensionName = null;
        foreach (var phaseBonus in phases)
        {
            foreach (var prop in phaseBonus.Keys)
            {
                if (BaseProps.ContainsKey(prop) || !AscensionProps.TryGetValue(prop, out var label)) continue;
                ascensionName = label.Name;
                break;
            }
            if (ascensionName is not null) break;
        }

        var ascensionValue = 0d;
        var extras = new List<NamedValue>();
        foreach (var (prop, value) in bonus)
        {
            if (BaseProps.ContainsKey(prop)) continue;
            if (!AscensionProps.TryGetValue(prop, out var label)) continue;
            var shown = Round6(label.IsPercent ? value * 100 : value);
            if (ascensionName is null)
            {
                ascensionName = label.Name;
                ascensionValue = shown;
            }
            extras.Add(new NamedValue { Name = label.Name, Value = shown });
        }

        if (character.Innate is not null)
        {
            foreach (var (key, value) in character.Innate)
            {
                if (key == "em") extras.Add(new NamedValue { Name = "Elemental Mastery", Value = value });
            }
        }

        return new CharacterBaseStats
        {
            Level = JsRound(level),
            Hp = hp,
            Atk = atk,
            Def = def,
            AscensionName = ascensionName,
            AscensionValue = ascensionValue,
            Innate = character.Innate,
            Extras = extras,
        };
    }

    public static WeaponStats? WeaponStatsAt(StatsCompact stats, string? weaponId, double level)
    {
        if (weaponId is null || !stats.Weapons.TryGetValue(weaponId, out var weapon)) return null;

        var phases = stats.WeaponPromote.TryGetValue(weapon.Promote, out var found)
            ? found
            : [new Dictionary<string, double>()];
        var lv = JsRound(level);
        var phase = AscensionPhase(phases, lv);
        var bonus = phases.Count > phase ? phases[phase] : new Dictionary<string, double>();
        var atk = weapon.Main.Base * CurveAt(stats.WeaponCurve, weapon.Main.Curve, lv)
            + Bonus(bonus, "FIGHT_PROP_BASE_ATTACK");

        string? subName = null;
        string? subProp = null;
        var subValue = 0d;
        if (weapon.Sub is not null)
        {
            AscensionProps.TryGetValue(weapon.Sub.Prop, out var label);
            var raw = weapon.Sub.Base * CurveAt(stats.WeaponCurve, weapon.Sub.Curve, lv);
            subProp = weapon.Sub.Prop;
            subName = label?.Name ?? weapon.Sub.Prop;
            subValue = Round6(label is { IsPercent: true } ? raw * 100 : raw);
        }

        return new WeaponStats
        {
            Level = lv,
            MaxLevel = weapon.MaxLevel,
            Atk = atk,
            SubName = subName,
            SubValue = subValue,
            SubProp = subProp,
        };
    }

    public static int? WeaponMaxLevel(StatsCompact stats, string? weaponId)
        => weaponId is not null && stats.Weapons.TryGetValue(weaponId, out var weapon)
            ? weapon.MaxLevel
            : null;

    private static double CurveAt(Dictionary<string, double[]> curves, string? name, double level)
    {
        if (name is null || !curves.TryGetValue(name, out var values)) return 1;
        var index = (int)JsRound(level) - 1;
        return index >= 0 && index < values.Length ? values[index] : 1;
    }

    private static double Bonus(Dictionary<string, double> values, string key)
        => values.TryGetValue(key, out var value) ? value : 0;

    private static double Round6(double value) => JsRound(value * 1_000_000) / 1_000_000;

    internal static double JsRound(double value) => Math.Floor(value + 0.5);

    private sealed record AscensionProp(string Name, bool IsPercent);
}
