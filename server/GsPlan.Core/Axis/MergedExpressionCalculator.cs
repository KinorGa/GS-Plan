namespace GsPlan.Core.Axis;

/// <summary>
/// Merges every damage row of one character into a closed-form polynomial over
/// the panel. Ported from <c>src/lib/merged-expression.js</c>: no fitting, no
/// sampling -- each row contributes its eight-term block and the blocks add.
/// </summary>
public static class MergedExpressionCalculator
{
    private const double CritRateCap = 100;

    private static readonly HashSet<string> PanelKeys = new(StringComparer.Ordinal)
    {
        "atk", "atkPct", "flatAtk", "hp", "hpPct", "flatHp", "def", "defPct", "flatDef",
        "critRate", "critDmg", "anemoDmg", "pyroDmg", "dmgBonus", "em",
    };

    public static MergedExpressionResult? Compute(
        MergedExpressionRequest request,
        AxisComputationData data)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(data);
        if (string.IsNullOrEmpty(request.CharId)) return null;

        var context = new AxisContext(data);
        var rows = new List<MergedRow>();
        var entryCount = 0;
        var suspicious = new List<string>();

        foreach (var entry in Flatten(request.Entries))
        {
            if (entry.CharId != request.CharId) continue;
            entryCount++;
            foreach (var part in AxisCalculator.ComputePartsForEntry(entry, context))
            {
                rows.Add(RowFromPart(part));
            }
            Touch(entry.StatOverrides, suspicious);
            foreach (var child in entry.Children ?? [])
            {
                Touch(child.StatOverrides, suspicious);
            }
        }

        var basePanel = PanelOf(request.CharId, context);
        if (basePanel is null) return null;
        var a0BySymbol = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["A"] = TotalAtkOf(basePanel),
            ["H"] = TotalHpOf(basePanel),
            ["D"] = TotalDefOf(basePanel),
            ["M"] = Get(basePanel, "em"),
        };

        var never = Accumulate(rows, a0BySymbol, _ => new CritForm(1, 0));
        var crit = Accumulate(rows, a0BySymbol, row => new CritForm(1 + row.CdBuff / 100, 1d / 100));
        var ampNever = AmpGroupsOf(rows, a0BySymbol, _ => new CritForm(1, 0), null);
        var ampCrit = AmpGroupsOf(
            rows,
            a0BySymbol,
            row => new CritForm(1 + row.CdBuff / 100, 1d / 100),
            null);
        var transformative = TransformativeGroupsOf(rows);

        var critRateBuffs = rows
            .Select(row => Round6(row.CrBuff))
            .Distinct()
            .OrderBy(value => value)
            .ToList();
        var avgGroups = critRateBuffs.Select(crBuff => new MergedAverageGroup
        {
            CrBuff = crBuff,
            Delta = Accumulate(
                rows,
                a0BySymbol,
                row => new CritForm(row.CdBuff / 100, 1d / 100),
                row => Math.Abs(row.CrBuff - crBuff) < 1e-6),
            Amp = AmpGroupsOf(
                rows,
                a0BySymbol,
                row => new CritForm(row.CdBuff / 100, 1d / 100),
                row => Math.Abs(row.CrBuff - crBuff) < 1e-6),
        }).ToList();

        var warnings = new List<MergedWarning>();
        if (suspicious.Count > 0)
        {
            warnings.Add(new MergedWarning
            {
                Code = "panel-override",
                Keys = suspicious,
                Detail = "Some entries override panel keys the expression varies; those rows stay pinned.",
            });
        }
        if (rows.Count == 0) warnings.Add(new MergedWarning { Code = "no-rows" });

        return new MergedExpressionResult
        {
            CharId = request.CharId,
            Entries = entryCount,
            Parts = rows.Count,
            ScalingBases = new[] { "atk", "hp", "def", "em" }
                .Where(key => rows.Any(row => row.ScalingBasis == key))
                .ToList(),
            Base = basePanel,
            Variables = VariablesOf(basePanel),
            Coeffs = new MergedCoefficients
            {
                Never = never,
                Crit = crit,
                AvgGroups = avgGroups,
                AmpNever = ampNever,
                AmpCrit = ampCrit,
                Transformative = transformative,
            },
            HasAmp = ampNever.Count > 0 || ampCrit.Count > 0,
            HasTransformative = transformative.Count > 0,
            Warnings = warnings,
        };
    }

    private static MergedRow RowFromPart(AxisPartComputation part)
    {
        var damage = part.Damage;
        var panel = part.Panel;
        var withBuffs = part.WithBuffs;
        var baseValue = damage.WithBonus / (1 + damage.BonusPct / 100);
        var element = part.Element;
        var ownKey = element == "Anemo" ? "anemoDmg" : element == "Pyro" ? "pyroDmg" : null;
        var fixedKey = element == "Physical"
            ? "physBonus"
            : !string.IsNullOrEmpty(element)
                ? char.ToLowerInvariant(element[0]) + element[1..] + "Dmg"
                : null;
        var ownIsVariable = ownKey is "anemoDmg" or "pyroDmg";
        var fixedPanel = fixedKey is not null && !ownIsVariable ? Get(panel, fixedKey) : 0;
        var fixedBuff = fixedKey is not null && !ownIsVariable
            ? Get(withBuffs, fixedKey) - fixedPanel
            : 0;

        var amp = part.Reaction.Amp;
        var ampBase = amp
            ? damage.DefMult * damage.ResMult * damage.ZoneMult * part.PartHits * part.Reaction.Base
            : 0;
        var ampBonus = amp ? Get(withBuffs, "reactionBonus") / 100 : 0;
        var emBuff = Get(withBuffs, "em") - Get(panel, "em");
        var reactionBonusPct = Get(withBuffs, "reactionBonus");
        var reactionBaseTotal = damage.ReactionBaseDamage * part.PartHits;

        return new MergedRow
        {
            ScalingBasis = damage.ScalingBasis,
            Symbol = SymbolFor(damage.ScalingBasis),
            Talent = damage.Talent,
            Fanout = baseValue - damage.ScalingValue * damage.Talent,
            ScalingValue = damage.ScalingValue,
            Rest = amp
                ? 0
                : damage.DefMult * damage.ResMult * damage.ReactMult
                    * damage.ZoneMult * part.PartHits,
            Amp = amp,
            AmpBase = ampBase,
            AmpBonus = ampBonus,
            EmBuff = emBuff,
            Animus = ownKey == "anemoDmg" ? Get(withBuffs, "anemoDmg") - Get(panel, "anemoDmg") : 0,
            Pyro = ownKey == "pyroDmg" ? Get(withBuffs, "pyroDmg") - Get(panel, "pyroDmg") : 0,
            Fixed = fixedPanel + fixedBuff,
            Generic = Get(withBuffs, "dmgBonus") - Get(panel, "dmgBonus"),
            CdBuff = Get(withBuffs, "critDmg") - Get(panel, "critDmg"),
            CrBuff = Get(withBuffs, "critRate") - Get(panel, "critRate"),
            RxConst = reactionBaseTotal * (1 + reactionBonusPct / 100),
            RxEm = reactionBaseTotal,
        };
    }

    private static Dictionary<string, double> Accumulate(
        IEnumerable<MergedRow> rows,
        IReadOnlyDictionary<string, double> a0BySymbol,
        Func<MergedRow, CritForm> qOf,
        Func<MergedRow, bool>? filter = null,
        Func<MergedRow, double>? weightOf = null)
    {
        var coeffs = new Dictionary<string, double>(StringComparer.Ordinal);
        void Add(string key, double value)
        {
            if (value == 0 || double.IsNaN(value)) return;
            coeffs[key] = coeffs.GetValueOrDefault(key) + value;
        }

        foreach (var row in rows)
        {
            if (filter is not null && !filter(row)) continue;
            var symbol = string.IsNullOrEmpty(row.Symbol) ? "A" : row.Symbol;
            var a0 = a0BySymbol.GetValueOrDefault(symbol);
            var fp = (row.ScalingValue - a0) * row.Talent + row.Fanout;
            var weight = weightOf is null ? row.Rest : weightOf(row);
            if (weight == 0 || double.IsNaN(weight)) continue;
            var sigma = 1 + (row.Fixed + row.Animus + row.Pyro + row.Generic) / 100;
            var forms = new (double C, string Mono)[]
            {
                (sigma, string.Empty),
                (row.Animus != 0 ? 1d / 100 : 0, "U"),
                (row.Pyro != 0 ? 1d / 100 : 0, "P"),
                (1d / 100, "G"),
            };
            var q = qOf(row);
            foreach (var (c, mono) in forms)
            {
                if (c == 0 || double.IsNaN(c)) continue;
                var key = weight * c;
                Add(mono.Length == 0 ? "1" : mono, key * fp * q.Q1);
                Add(mono.Length == 0 ? symbol : symbol + "*" + mono, key * row.Talent * q.Q1);
                if (q.QC != 0 && !double.IsNaN(q.QC))
                {
                    Add(mono.Length == 0 ? "C" : mono + "*C", key * fp * q.QC);
                    Add(
                        mono.Length == 0 ? symbol + "*C" : symbol + "*" + mono + "*C",
                        key * row.Talent * q.QC);
                }
            }
        }
        return coeffs;
    }

    private static List<MergedAmplifyingGroup> AmpGroupsOf(
        IEnumerable<MergedRow> rows,
        IReadOnlyDictionary<string, double> a0BySymbol,
        Func<MergedRow, CritForm> qOf,
        Func<MergedRow, bool>? filter)
    {
        var groups = new Dictionary<(double EmBuff, double Bonus), List<MergedRow>>();
        foreach (var row in rows)
        {
            if (!row.Amp || (filter is not null && !filter(row))) continue;
            var key = (Round6(row.EmBuff), Round6(row.AmpBonus));
            if (!groups.TryGetValue(key, out var list))
            {
                list = [];
                groups[key] = list;
            }
            list.Add(row);
        }
        return groups
            .OrderBy(pair => pair.Key.EmBuff)
            .ThenBy(pair => pair.Key.Bonus)
            .Select(pair => new MergedAmplifyingGroup
            {
                EmBuff = pair.Key.EmBuff,
                Bonus = pair.Key.Bonus,
                Coeffs = Accumulate(pair.Value, a0BySymbol, qOf, null, row => row.AmpBase),
            })
            .ToList();
    }

    private static List<MergedTransformativeGroup> TransformativeGroupsOf(
        IEnumerable<MergedRow> rows)
    {
        var groups = new Dictionary<double, (double Constant, double Em)>();
        foreach (var row in rows)
        {
            if (row.RxConst == 0 && row.RxEm == 0) continue;
            var emBuff = Round6(row.EmBuff);
            var current = groups.GetValueOrDefault(emBuff);
            groups[emBuff] = (current.Constant + row.RxConst, current.Em + row.RxEm);
        }
        return groups
            .OrderBy(pair => pair.Key)
            .Select(pair => new MergedTransformativeGroup
            {
                EmBuff = pair.Key,
                Constant = pair.Value.Constant,
                Em = pair.Value.Em,
            })
            .ToList();
    }

    private static Dictionary<string, double>? PanelOf(string charId, AxisContext context)
    {
        var state = context.PanelForEntry(new AxisEntry { CharId = charId });
        if (!state.HasDetail) return null;
        var panel = state.Panel;
        return new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["atk"] = Get(panel, "atk"),
            ["atkPct"] = Get(panel, "atkPct"),
            ["flatAtk"] = Get(panel, "flatAtk"),
            ["hp"] = Get(panel, "hp"),
            ["hpPct"] = Get(panel, "hpPct"),
            ["flatHp"] = Get(panel, "flatHp"),
            ["def"] = Get(panel, "def"),
            ["defPct"] = Get(panel, "defPct"),
            ["flatDef"] = Get(panel, "flatDef"),
            ["critRate"] = Get(panel, "critRate"),
            ["critDmg"] = Get(panel, "critDmg"),
            ["anemoDmg"] = Get(panel, "anemoDmg"),
            ["pyroDmg"] = Get(panel, "pyroDmg"),
            ["dmgBonus"] = Get(panel, "dmgBonus"),
            ["em"] = Get(panel, "em"),
        };
    }

    /// <summary>
    /// Convert a flat panel into the ten symbols the merged polynomial uses.
    /// Shared by the expression builder and the evaluation endpoint.
    /// </summary>
    public static Dictionary<string, double> VariablesOf(IReadOnlyDictionary<string, double> panel)
        => new(StringComparer.Ordinal)
        {
            ["A"] = TotalAtkOf(panel),
            ["H"] = TotalHpOf(panel),
            ["D"] = TotalDefOf(panel),
            ["M"] = Get(panel, "em"),
            ["U"] = Get(panel, "anemoDmg"),
            ["P"] = Get(panel, "pyroDmg"),
            ["G"] = Get(panel, "dmgBonus"),
            ["C"] = Get(panel, "critDmg"),
            ["R"] = Get(panel, "critRate"),
            ["E"] = Get(panel, "em"),
        };

    private static IEnumerable<AxisEntry> Flatten(IEnumerable<AxisEntry>? entries)
    {
        foreach (var entry in entries ?? [])
        {
            if (entry.Kind == "segment")
            {
                foreach (var nested in Flatten(entry.Children)) yield return nested;
            }
            else
            {
                yield return entry;
            }
        }
    }

    private static void Touch(
        IReadOnlyDictionary<string, double>? overrides,
        List<string> suspicious)
    {
        foreach (var key in overrides?.Keys ?? [])
        {
            if (PanelKeys.Contains(key) && !suspicious.Contains(key)) suspicious.Add(key);
        }
    }

    private static string SymbolFor(string scalingBasis) => scalingBasis switch
    {
        "hp" => "H",
        "def" => "D",
        "em" => "M",
        _ => "A",
    };

    private static double TotalAtkOf(IReadOnlyDictionary<string, double> panel)
        => Get(panel, "atk") * (1 + Get(panel, "atkPct") / 100) + Get(panel, "flatAtk");

    private static double TotalHpOf(IReadOnlyDictionary<string, double> panel)
        => Get(panel, "hp") * (1 + Get(panel, "hpPct") / 100) + Get(panel, "flatHp");

    private static double TotalDefOf(IReadOnlyDictionary<string, double> panel)
        => Get(panel, "def") * (1 + Get(panel, "defPct") / 100) + Get(panel, "flatDef");

    private static double Get(IReadOnlyDictionary<string, double> panel, string key)
        => panel.TryGetValue(key, out var value) ? value : 0;

    private static double Round6(double value)
        => Math.Floor(value * 1e6 + 0.5) / 1e6;

    private readonly record struct CritForm(double Q1, double QC);

    private sealed class MergedRow
    {
        public string ScalingBasis { get; init; } = "atk";
        public string Symbol { get; init; } = "A";
        public double Talent { get; init; }
        public double Fanout { get; init; }
        public double ScalingValue { get; init; }
        public double Rest { get; init; }
        public bool Amp { get; init; }
        public double AmpBase { get; init; }
        public double AmpBonus { get; init; }
        public double EmBuff { get; init; }
        public double Animus { get; init; }
        public double Pyro { get; init; }
        public double Fixed { get; init; }
        public double Generic { get; init; }
        public double CdBuff { get; init; }
        public double CrBuff { get; init; }
        public double RxConst { get; init; }
        public double RxEm { get; init; }
    }
}
