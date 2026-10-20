using System.Globalization;
using GsPlan.Core.Axis;
using GsPlan.Core.Stats;

namespace GsPlan.Core.Artifacts;

/// <summary>
/// The C# half of the artifact optimiser's text protocol. It writes exactly the
/// problem format <c>native/optimize/main.cpp</c> reads and reads its CSV back
/// into named rows. The C++ search itself is deliberately unchanged.
/// </summary>
public static class ArtifactOptimizeCalculator
{
    /// <summary>The fixed 40-wide monomial order shared with the JS builder and C++.</summary>
    public static readonly string[] MonoOrder =
    [
        "1", "U", "P", "G", "C", "U*C", "P*C", "G*C",
        .. new[] { "A", "H", "D", "M" }.SelectMany(symbol => new[]
        {
            symbol,
            symbol + "*U",
            symbol + "*P",
            symbol + "*G",
            symbol + "*C",
            symbol + "*U*C",
            symbol + "*P*C",
            symbol + "*G*C",
        }),
    ];

    private static readonly string[] PanelColumns = ["A", "H", "D", "M", "C", "R", "E"];

    public static string BuildProblem(ArtifactOptimizeRequest request)
    {
        if (request.Coeffs is null)
        {
            throw new InvalidOperationException("coeffs is required");
        }

        var panel = request.Panel ?? new ArtifactPanel();
        var rows = new List<string>();
        void Put(string kind, params string[] rest)
            => rows.Add(string.Join(" ", new[] { kind }.Concat(rest)));

        rows.Add("# artifact-optimize problem: generated, not hand-written");
        Put(
            "panel",
            Num(panel.Atk), Num(panel.AtkPct), Num(panel.FlatAtk),
            Num(panel.CritRate), Num(panel.CritDmg),
            Num(panel.AnemoDmg), Num(panel.PyroDmg), Num(panel.DmgBonus), Num(panel.Em),
            Num(panel.Hp), Num(panel.HpPct), Num(panel.FlatHp),
            Num(panel.Def), Num(panel.DefPct), Num(panel.FlatDef));

        foreach (var key in ArtifactModel.SubStatOrder)
        {
            Put("hit", key, Num(SubstatRolls.HitValueOf(key, request.HitScale, request.Rarity)));
        }

        foreach (var piece in request.Pieces ?? [])
        {
            Put("piece", piece.Slot, Num(piece.Lines), Num(piece.Rolls), Num(piece.MaxPerLine));
        }
        foreach (var piece in request.Pieces ?? [])
        {
            foreach (var allow in piece.Allows ?? [])
            {
                if (allow.State < 1) continue;
                Put("allow", piece.Slot, allow.Key, allow.State >= 2 ? "2" : "1");
            }
        }

        var coeffs = request.Coeffs;
        Put("coeff", "never", Vector(coeffs.Never));
        Put("coeff", "crit", Vector(coeffs.Crit));
        foreach (var group in coeffs.AvgGroups ?? [])
        {
            Put("group", Num(group.CrBuff), Vector(group.Delta));
            foreach (var amp in group.Amp ?? [])
            {
                Put(
                    "amp",
                    "group",
                    Num(group.CrBuff),
                    Num(amp.EmBuff),
                    Num(amp.Bonus),
                    Vector(amp.Coeffs));
            }
        }
        foreach (var amp in coeffs.AmpNever ?? [])
        {
            Put(
                "amp",
                "never",
                Num(amp.EmBuff),
                Num(amp.Bonus),
                Vector(amp.Coeffs));
        }
        foreach (var amp in coeffs.AmpCrit ?? [])
        {
            Put(
                "amp",
                "crit",
                Num(amp.EmBuff),
                Num(amp.Bonus),
                Vector(amp.Coeffs));
        }
        foreach (var group in coeffs.Transformative ?? [])
        {
            Put("rx", Num(group.EmBuff), Num(group.Constant), Num(group.Em));
        }

        if (request.Ref is { } reference)
        {
            Put(
                "ref",
                Num(reference.A),
                Num(reference.H),
                Num(reference.D),
                Num(reference.M),
                Num(reference.C),
                Num(reference.R),
                Num(reference.E));
        }

        return string.Join("\n", rows) + "\n";
    }

    /// <summary>
    /// The optimiser's CSV as rows. Columns are read by NAME, so a program that
    /// grows a column cannot silently shift roll counts onto the wrong stat.
    /// </summary>
    public static ArtifactOptimizeParsed ParseResult(string? text)
    {
        var raw = (text ?? string.Empty).Replace("\uFEFF", string.Empty);
        var lines = raw
            .Split('\n')
            .Select(line => line.TrimEnd('\r'))
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .ToList();

        if (lines.Count == 0) return new ArtifactOptimizeParsed();

        var head = lines[0].Split(',').Select(cell => cell.Trim()).ToArray();
        int At(string name) => Array.IndexOf(head, name);

        var aAt = At("A");
        var totalAt = At("total");
        var hAt = At("H");
        var dAt = At("D");
        var mAt = At("M");
        var cAt = At("C");
        var rAt = At("R");
        var eAt = At("E");
        var neverAt = At("dmg_never");
        var critAt = At("dmg_crit");
        var avgAt = At("dmg_avg");
        var currentAt = At("is_current");
        if (aAt < 1)
        {
            throw new InvalidOperationException("unexpected optimiser header: " + lines[0]);
        }

        var panelAt = PanelColumns
            .Select(At)
            .Where(index => index >= 0)
            .DefaultIfEmpty(-1)
            .Min();

        var statsEnd = totalAt >= 0 && panelAt >= 0
            ? Math.Min(totalAt, panelAt)
            : totalAt >= 0 ? totalAt : panelAt >= 0 ? panelAt : aAt;
        var stats = head.Take(statsEnd).ToList();

        var rows = new List<ArtifactOptimizeRow>();
        for (var index = 1; index < lines.Count; index++)
        {
            var cells = lines[index].Split(',');
            var hasHits = Enumerable.Range(0, stats.Count)
                .Any(column => column < cells.Length && !string.IsNullOrWhiteSpace(cells[column]));
            var hits = new Dictionary<string, double>(StringComparer.Ordinal);
            for (var column = 0; column < stats.Count; column++)
            {
                hits[stats[column]] = Number(Cell(cells, column));
            }

            var total = totalAt >= 0
                ? Number(Cell(cells, totalAt))
                : stats.Sum(key => hits[key]);

            rows.Add(new ArtifactOptimizeRow
            {
                Hits = hits,
                HasHits = hasHits,
                Total = total,
                A = Number(Cell(cells, aAt)),
                H = Number(Cell(cells, hAt)),
                D = Number(Cell(cells, dAt)),
                M = Number(Cell(cells, mAt)),
                C = Number(Cell(cells, cAt)),
                R = Number(Cell(cells, rAt)),
                E = Number(Cell(cells, eAt)),
                Never = Number(Cell(cells, neverAt)),
                Crit = Number(Cell(cells, critAt)),
                Avg = Number(Cell(cells, avgAt)),
                IsCurrent = Cell(cells, currentAt) == "1",
            });
        }

        return new ArtifactOptimizeParsed { Stats = stats, Rows = rows };
    }

    private static string Vector(IReadOnlyDictionary<string, double>? coeffs)
        => string.Join(
            " ",
            MonoOrder.Select(key => Num(
                coeffs is not null && coeffs.TryGetValue(key, out var value) ? value : 0)));

    private static string? Cell(string[] cells, int index)
        => index >= 0 && index < cells.Length ? cells[index] : null;

    private static double Number(string? cell)
    {
        if (string.IsNullOrWhiteSpace(cell)) return 0;
        return double.TryParse(
            cell,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var value) && double.IsFinite(value)
            ? value
            : 0;
    }

    /// <summary>
    /// ECMAScript's Number-to-string form, so the C# problem text is byte-for-byte
    /// the same as the JS fallback's. The C++ reader only needs a number, but the
    /// parity test compares the protocol itself.
    /// </summary>
    private static string Num(double value)
    {
        if (!double.IsFinite(value) || value == 0) return "0";

        var negative = value < 0;
        if (negative) value = -value;

        var raw = value.ToString("R", CultureInfo.InvariantCulture);
        var exponentAt = raw.IndexOfAny(['E', 'e']);
        var mantissa = exponentAt >= 0 ? raw[..exponentAt] : raw;
        var exponent = 0;
        if (exponentAt >= 0)
        {
            int.TryParse(
                raw[(exponentAt + 1)..],
                NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture,
                out exponent);
        }

        var dot = mantissa.IndexOf('.');
        var integerPart = dot >= 0 ? mantissa[..dot] : mantissa;
        var fractionPart = dot >= 0 ? mantissa[(dot + 1)..] : string.Empty;
        var allDigits = integerPart + fractionPart;

        var first = 0;
        while (first < allDigits.Length && allDigits[first] == '0') first++;
        if (first == allDigits.Length) return "0";

        var digits = allDigits[first..].TrimEnd('0');
        var exponent10 = integerPart.Length - 1 - first + exponent;

        string text;
        if (exponent10 >= -6 && exponent10 < 21)
        {
            if (exponent10 < 0)
            {
                text = "0." + new string('0', -exponent10 - 1) + digits;
            }
            else if (exponent10 + 1 >= digits.Length)
            {
                text = digits + new string('0', exponent10 + 1 - digits.Length);
            }
            else
            {
                text = digits[..(exponent10 + 1)] + "." + digits[(exponent10 + 1)..];
            }
        }
        else
        {
            text = digits[0]
                + (digits.Length > 1 ? "." + digits[1..] : string.Empty)
                + "e"
                + (exponent10 >= 0 ? "+" : string.Empty)
                + exponent10.ToString(CultureInfo.InvariantCulture);
        }

        return negative ? "-" + text : text;
    }
}
