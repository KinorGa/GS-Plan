using GsPlan.Core.Axis;
using GsPlan.Core.Stats;

namespace GsPlan.Core.Artifacts;

/// <summary>
/// The pure planning half of the artifact optimiser. It turns a build and a
/// merged damage expression into the piece shapes, feeding-stat list and
/// structured request the C++ search consumes. Mirrors the remaining pure
/// functions in <c>src/lib/artifact-optimize.js</c>.
/// </summary>
public static class ArtifactOptimizePlanner
{
    public const double DefaultHitScale = 0.8;
    public const int PieceLines = 4;
    public const int UpgradesDefault = 5;
    public const int MaxRollsPerLine = 6;

    private static readonly Dictionary<string, string> FeedField = new(StringComparer.Ordinal)
    {
        ["atkPct"] = "atkPct",
        ["atk"] = "flatAtk",
        ["hpPct"] = "hpPct",
        ["hp"] = "flatHp",
        ["defPct"] = "defPct",
        ["def"] = "flatDef",
        ["critRate"] = "critRate",
        ["critDmg"] = "critDmg",
        ["em"] = "em",
    };

    public static ArtifactPlanResult Plan(ArtifactPlanRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var expr = request.Expr
            ?? throw new InvalidOperationException("expr is required");

        var pieces = BuildPieces(request);
        var feeding = FeedingSubstatsFor(expr);
        var variables = request.CurrentPanel is null
            ? new Dictionary<string, double>(StringComparer.Ordinal)
            : VariablesOf(request.CurrentPanel);
        var implied = ImpliedHits(
            request.BasePanel,
            request.CurrentPanel,
            feeding,
            1);

        var output = new ArtifactOptimizeRequest
        {
            Coeffs = expr.Coeffs,
            Panel = PanelFrom(request.BasePanel),
            Ref = request.CurrentPanel is null ? null : RefFrom(request.CurrentPanel),
            Pieces = pieces.Select(piece => new ArtifactPieceSpec
            {
                Slot = piece.Slot,
                Lines = piece.Lines,
                Rolls = piece.Rolls,
                MaxPerLine = piece.MaxPerLine,
                Allows = piece.Allows,
            }).ToList(),
            HitScale = request.HitScale,
            Rarity = request.Rarity,
        };

        var feasibility = pieces.Select(piece =>
        {
            var usable = (piece.Allows ?? []).Count(allow => allow.State >= 1);
            var must = (piece.Allows ?? []).Count(allow => allow.State >= 2);
            return new ArtifactPieceFeasibility
            {
                Slot = piece.Slot,
                Usable = usable,
                Must = must,
                Ok = usable >= piece.Lines && must <= piece.Lines,
            };
        }).ToList();

        return new ArtifactPlanResult
        {
            Pieces = pieces,
            FeedingSubstats = feeding,
            ImpliedHits = implied,
            Variables = variables,
            Feasibility = feasibility,
            Feasible = feasibility.All(item => item.Ok),
            Request = output,
        };
    }

    public static List<string> ScalingBasesOf(MergedExpressionResult? expr)
    {
        if (expr?.ScalingBases is { Count: > 0 } declared)
        {
            return declared.ToList();
        }

        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var coeffs in CoefficientMaps(expr))
        {
            foreach (var (key, value) in coeffs)
            {
                if (value == 0) continue;
                if (key == "A" || key.StartsWith("A*", StringComparison.Ordinal)) found.Add("atk");
                if (key == "H" || key.StartsWith("H*", StringComparison.Ordinal)) found.Add("hp");
                if (key == "D" || key.StartsWith("D*", StringComparison.Ordinal)) found.Add("def");
                if (key == "M" || key.StartsWith("M*", StringComparison.Ordinal)) found.Add("em");
            }
        }

        var order = new[] { "atk", "hp", "def", "em" };
        var result = order.Where(found.Contains).ToList();
        return result.Count > 0 ? result : ["atk"];
    }

    public static bool EmMattersIn(MergedExpressionResult? expr)
        => expr?.HasAmp == true
            || expr?.HasTransformative == true
            || ScalingBasesOf(expr).Contains("em", StringComparer.Ordinal);

    public static List<string> FeedingSubstatsFor(MergedExpressionResult? expr)
    {
        var bases = new HashSet<string>(ScalingBasesOf(expr), StringComparer.Ordinal);
        var result = new List<string>();
        if (bases.Contains("atk")) result.AddRange(["atkPct", "atk"]);
        if (bases.Contains("hp")) result.AddRange(["hpPct", "hp"]);
        if (bases.Contains("def")) result.AddRange(["defPct", "def"]);
        result.AddRange(["critRate", "critDmg"]);
        if (EmMattersIn(expr)) result.Add("em");
        return result;
    }

    public static double ImpliedHits(
        IReadOnlyDictionary<string, double>? basePanel,
        IReadOnlyDictionary<string, double>? currentPanel,
        IReadOnlyList<string> keys,
        double scale = 1)
    {
        if (basePanel is null || currentPanel is null) return 0;
        var sum = 0d;
        foreach (var key in keys)
        {
            if (!FeedField.TryGetValue(key, out var field)) continue;
            var per = SubstatRolls.HitValueOf(key, scale, SubstatRolls.DefaultRarity);
            if (per == 0) continue;
            sum += Math.Max(0, Get(currentPanel, field) - Get(basePanel, field)) / per;
        }
        return sum;
    }

    public static List<string> AllowedSubstatsFor(string? mainStat)
        => ArtifactModel.SubStatOrder
            .Where(key => !string.Equals(key, mainStat, StringComparison.Ordinal))
            .ToList();

    public static ArtifactPieceSpec PieceSpec(
        string slot,
        string? mainStat,
        int upgrades = UpgradesDefault,
        int lines = PieceLines,
        int maxPerLine = MaxRollsPerLine,
        IEnumerable<ArtifactAllow>? allows = null)
    {
        var legal = AllowedSubstatsFor(mainStat);
        List<ArtifactAllow> cells;
        if (allows is null)
        {
            cells = legal.Select(key => new ArtifactAllow { Key = key, State = 1 }).ToList();
        }
        else
        {
            var byKey = new Dictionary<string, ArtifactAllow>(StringComparer.Ordinal);
            foreach (var allow in allows)
            {
                if (!string.IsNullOrEmpty(allow.Key)) byKey[allow.Key] = allow;
            }
            cells = legal
                .Where(byKey.ContainsKey)
                .Select(key => new ArtifactAllow { Key = key, State = byKey[key].State })
                .ToList();
        }

        return new ArtifactPieceSpec
        {
            Slot = slot,
            MainStat = mainStat,
            Lines = lines,
            Rolls = lines + upgrades,
            MaxPerLine = maxPerLine,
            Allows = cells,
        };
    }

    public static List<ArtifactPieceSpec> DefaultPieces(
        IReadOnlyDictionary<string, ArtifactPiece>? build,
        int upgrades = UpgradesDefault,
        int lines = PieceLines,
        int maxPerLine = MaxRollsPerLine)
        => ArtifactModel.SlotKeys
            .Select(slot => PieceSpec(
                slot,
                build is not null && build.TryGetValue(slot, out var piece) ? piece?.MainStat : null,
                upgrades,
                lines,
                maxPerLine))
            .ToList();

    public static List<ArtifactPieceSpec> ImportPieces(
        IReadOnlyDictionary<string, ArtifactPiece>? build,
        int upgrades = UpgradesDefault,
        int lines = PieceLines,
        int maxPerLine = MaxRollsPerLine)
    {
        var result = new List<ArtifactPieceSpec>();
        foreach (var slot in ArtifactModel.SlotKeys)
        {
            var piece = build is not null && build.TryGetValue(slot, out var found) ? found : null;
            var mainStat = piece?.MainStat;
            var cells = AllowedSubstatsFor(mainStat)
                .Select(key => new ArtifactAllow { Key = key, State = 1 })
                .ToList();

            foreach (var sub in piece?.SubStats ?? [])
            {
                var value = ArtifactSummary.SubValue(sub);
                if (sub is null || string.IsNullOrEmpty(sub.Key) || value is null || value <= 0) continue;
                var at = cells.FindIndex(cell => string.Equals(cell.Key, sub.Key, StringComparison.Ordinal));
                if (at >= 0) cells[at] = new ArtifactAllow { Key = sub.Key, State = 2 };
            }

            result.Add(PieceSpec(slot, mainStat, upgrades, lines, maxPerLine, cells));
        }
        return result;
    }

    private static List<ArtifactPieceSpec> BuildPieces(ArtifactPlanRequest request)
    {
        if (request.Pieces is { Count: > 0 } supplied)
        {
            return supplied.Select(piece =>
            {
                var lines = piece.Lines > 0 ? piece.Lines : request.Lines;
                var maxPerLine = piece.MaxPerLine > 0 ? piece.MaxPerLine : request.MaxPerLine;
                var rolls = piece.Rolls > 0 ? piece.Rolls : lines + request.Upgrades;
                var normalized = PieceSpec(
                    piece.Slot,
                    piece.MainStat,
                    request.Upgrades,
                    lines,
                    maxPerLine,
                    piece.Allows);
                // An explicit card shape is UI state and wins over the request
                // defaults; only a missing shape is filled from the request.
                normalized.Lines = lines;
                normalized.Rolls = rolls;
                normalized.MaxPerLine = maxPerLine;
                return normalized;
            }).ToList();
        }

        var build = request.Build;
        var mode = (request.Mode ?? "auto").Trim().ToLowerInvariant();
        var import = mode == "import"
            || (mode == "auto" && ArtifactSummary.HasWornSubstats(build));
        return import
            ? ImportPieces(build, request.Upgrades, request.Lines, request.MaxPerLine)
            : DefaultPieces(build, request.Upgrades, request.Lines, request.MaxPerLine);
    }

    private static IEnumerable<Dictionary<string, double>> CoefficientMaps(MergedExpressionResult? expr)
    {
        if (expr?.Coeffs is null) yield break;
        var coeffs = expr.Coeffs;
        yield return coeffs.Never;
        yield return coeffs.Crit;
        foreach (var group in coeffs.AvgGroups ?? [])
        {
            yield return group.Delta;
            foreach (var amp in group.Amp ?? []) yield return amp.Coeffs;
        }
        foreach (var amp in coeffs.AmpNever ?? []) yield return amp.Coeffs;
        foreach (var amp in coeffs.AmpCrit ?? []) yield return amp.Coeffs;
    }

    private static ArtifactPanel PanelFrom(IReadOnlyDictionary<string, double>? panel)
    {
        if (panel is null) return new ArtifactPanel();
        return new ArtifactPanel
        {
            Atk = Get(panel, "atk"),
            AtkPct = Get(panel, "atkPct"),
            FlatAtk = Get(panel, "flatAtk"),
            CritRate = Get(panel, "critRate"),
            CritDmg = Get(panel, "critDmg"),
            AnemoDmg = Get(panel, "anemoDmg"),
            PyroDmg = Get(panel, "pyroDmg"),
            DmgBonus = Get(panel, "dmgBonus"),
            Em = Get(panel, "em"),
            Hp = Get(panel, "hp"),
            HpPct = Get(panel, "hpPct"),
            FlatHp = Get(panel, "flatHp"),
            Def = Get(panel, "def"),
            DefPct = Get(panel, "defPct"),
            FlatDef = Get(panel, "flatDef"),
        };
    }

    private static ArtifactRef RefFrom(IReadOnlyDictionary<string, double> panel)
    {
        var variables = VariablesOf(panel);
        return new ArtifactRef
        {
            A = Get(variables, "A"),
            H = Get(variables, "H"),
            D = Get(variables, "D"),
            M = Get(variables, "M"),
            C = Get(variables, "C"),
            R = Get(variables, "R"),
            E = Get(variables, "E"),
        };
    }

    private static Dictionary<string, double> VariablesOf(IReadOnlyDictionary<string, double> panel)
        => new(StringComparer.Ordinal)
        {
            ["A"] = Get(panel, "atk") * (1 + Get(panel, "atkPct") / 100) + Get(panel, "flatAtk"),
            ["H"] = Get(panel, "hp") * (1 + Get(panel, "hpPct") / 100) + Get(panel, "flatHp"),
            ["D"] = Get(panel, "def") * (1 + Get(panel, "defPct") / 100) + Get(panel, "flatDef"),
            ["M"] = Get(panel, "em"),
            ["U"] = Get(panel, "anemoDmg"),
            ["P"] = Get(panel, "pyroDmg"),
            ["G"] = Get(panel, "dmgBonus"),
            ["C"] = Get(panel, "critDmg"),
            ["R"] = Get(panel, "critRate"),
            ["E"] = Get(panel, "em"),
        };

    private static double Get(IReadOnlyDictionary<string, double> panel, string key)
        => panel.TryGetValue(key, out var value) ? value : 0;
}

public sealed class ArtifactPlanRequest
{
    public MergedExpressionResult? Expr { get; set; }
    public Dictionary<string, ArtifactPiece>? Build { get; set; }
    public List<ArtifactPieceSpec>? Pieces { get; set; }
    public Dictionary<string, double>? BasePanel { get; set; }
    public Dictionary<string, double>? CurrentPanel { get; set; }
    public string Mode { get; set; } = "auto";
    public int Upgrades { get; set; } = ArtifactOptimizePlanner.UpgradesDefault;
    public int Lines { get; set; } = ArtifactOptimizePlanner.PieceLines;
    public int MaxPerLine { get; set; } = ArtifactOptimizePlanner.MaxRollsPerLine;
    public double HitScale { get; set; } = ArtifactOptimizePlanner.DefaultHitScale;
    public int Rarity { get; set; } = SubstatRolls.DefaultRarity;
}

public sealed class ArtifactPlanResult
{
    public List<ArtifactPieceSpec> Pieces { get; init; } = [];
    public List<string> FeedingSubstats { get; init; } = [];
    public double ImpliedHits { get; init; }
    public Dictionary<string, double> Variables { get; init; } = new(StringComparer.Ordinal);
    public List<ArtifactPieceFeasibility> Feasibility { get; init; } = [];
    public bool Feasible { get; init; }
    public ArtifactOptimizeRequest Request { get; init; } = new();
}

public sealed class ArtifactPieceFeasibility
{
    public string Slot { get; init; } = string.Empty;
    public int Usable { get; init; }
    public int Must { get; init; }
    public bool Ok { get; init; }
}
