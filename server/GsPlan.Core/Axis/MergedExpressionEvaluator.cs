namespace GsPlan.Core.Axis;

/// <summary>
/// Evaluates a merged damage polynomial at one panel. Ported from
/// <c>damageAt()</c>, <c>evaluate()</c> and <c>evaluateAmp()</c> in
/// <c>src/lib/merged-expression.js</c>; the browser only formats the result.
/// </summary>
public static class MergedExpressionEvaluator
{
    private const double CritRateCap = 100;

    private static readonly string[] BonusSymbols = ["U", "P", "G"];

    public static MergedEvaluationResult Evaluate(MergedEvaluationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var expr = request.Expr
            ?? throw new InvalidOperationException("expr is required");
        var variables = request.Variables
            ?? MergedExpressionCalculator.VariablesOf(request.Panel ?? new Dictionary<string, double>());

        var never = NeverAt(expr, variables);
        var crit = CritAt(expr, variables);
        var rate = Get(variables, "R");
        var avg = never;
        var groups = new List<MergedAverageEvaluation>();

        foreach (var group in expr.Coeffs.AvgGroups)
        {
            var mu = Math.Min(rate + group.CrBuff, CritRateCap) / 100;
            var delta = EvaluateCoefficients(group.Delta, variables);
            var amp = EvaluateAmp(group.Amp, variables);
            var df = delta + amp;
            var contrib = mu * df;
            avg += contrib;
            groups.Add(new MergedAverageEvaluation
            {
                CrBuff = group.CrBuff,
                Mu = mu,
                Delta = delta,
                Amp = amp,
                Df = df,
                Contrib = contrib,
            });
        }

        return new MergedEvaluationResult
        {
            Variables = variables,
            Never = never,
            Crit = crit,
            Avg = avg,
            Groups = groups,
        };
    }

    public static double NeverAt(
        MergedExpressionResult expr,
        IReadOnlyDictionary<string, double> variables)
        => EvaluateCoefficients(expr.Coeffs.Never, variables)
            + EvaluateAmp(expr.Coeffs.AmpNever, variables)
            + EvaluateTransformative(expr.Coeffs.Transformative, variables);

    public static double CritAt(
        MergedExpressionResult expr,
        IReadOnlyDictionary<string, double> variables)
        => EvaluateCoefficients(expr.Coeffs.Crit, variables)
            + EvaluateAmp(expr.Coeffs.AmpCrit, variables)
            + EvaluateTransformative(expr.Coeffs.Transformative, variables);

    /// <summary>Evaluate one polynomial at one point. CRIT Rate is not read here.</summary>
    public static double EvaluateCoefficients(
        IReadOnlyDictionary<string, double>? coeffs,
        IReadOnlyDictionary<string, double> variables)
    {
        if (coeffs is null || coeffs.Count == 0) return 0;

        var a = Get(variables, "A");
        var h = Get(variables, "H");
        var d = Get(variables, "D");
        var m = Get(variables, "M");
        var u = Get(variables, "U");
        var p = Get(variables, "P");
        var g = Get(variables, "G");
        var c = Get(variables, "C");

        var monomials = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["1"] = 1,
            ["U"] = u,
            ["P"] = p,
            ["G"] = g,
            ["C"] = c,
            ["U*C"] = u * c,
            ["P*C"] = p * c,
            ["G*C"] = g * c,
        };
        foreach (var (symbol, value) in new[] { ("A", a), ("H", h), ("D", d), ("M", m) })
        {
            monomials[symbol] = value;
            foreach (var bonus in BonusSymbols)
            {
                var bonusValue = Get(variables, bonus);
                monomials[symbol + "*" + bonus] = value * bonusValue;
                monomials[symbol + "*" + bonus + "*C"] = value * bonusValue * c;
            }
            monomials[symbol + "*C"] = value * c;
        }

        var sum = 0.0;
        foreach (var (key, coefficient) in coeffs)
        {
            sum += coefficient * monomials.GetValueOrDefault(key);
        }
        return sum;
    }

    /// <summary><c>Σ emFactor(E + row EM buff) * polynomial</c>.</summary>
    public static double EvaluateAmp(
        IReadOnlyList<MergedAmplifyingGroup>? groups,
        IReadOnlyDictionary<string, double> variables)
    {
        if (groups is null || groups.Count == 0) return 0;
        var em = Get(variables, "E");
        var sum = 0.0;
        foreach (var group in groups)
        {
            var factor = EmFactor(em + group.EmBuff) + group.Bonus;
            sum += factor * EvaluateCoefficients(group.Coeffs, variables);
        }
        return sum;
    }

    /// <summary><c>Σ [constant + weight * T(E + row EM buff)]</c>.</summary>
    public static double EvaluateTransformative(
        IReadOnlyList<MergedTransformativeGroup>? groups,
        IReadOnlyDictionary<string, double> variables)
    {
        if (groups is null || groups.Count == 0) return 0;
        var em = Get(variables, "E");
        var sum = 0.0;
        foreach (var group in groups)
        {
            sum += group.Constant
                + group.Em * TransformativeEmFactor(em + group.EmBuff);
        }
        return sum;
    }

    /// <summary>REF: docs/REACTIONS.md#amplifying, <c>1 + 2.78 EM / (EM + 1400)</c>.</summary>
    public static double EmFactor(double em)
        => 1 + (2.78 * em) / (em + 1400);

    /// <summary>REF: docs/REACTIONS.md#transformative, <c>16 EM / (EM + 2000)</c>.</summary>
    public static double TransformativeEmFactor(double em)
    {
        var value = Math.Max(0, em);
        return (16 * value) / (value + 2000);
    }

    private static double Get(IReadOnlyDictionary<string, double> variables, string key)
        => variables.TryGetValue(key, out var value) ? value : 0;
}
