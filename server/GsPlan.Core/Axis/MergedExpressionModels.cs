namespace GsPlan.Core.Axis;

/// <summary>
/// The request for a character's artifact-facing damage polynomial. It carries
/// the same axis and team as the whole-axis route, plus the one character whose
/// rows are merged.
/// </summary>
public sealed class MergedExpressionRequest
{
    public string Lang { get; set; } = "chs";
    public string? CharId { get; set; }
    public List<AxisEntry> Entries { get; set; } = [];
    public List<AxisTeamUnit> Team { get; set; } = [];
}

public sealed class MergedExpressionResult
{
    public string CharId { get; init; } = string.Empty;
    public int Entries { get; init; }
    public int Parts { get; init; }
    public List<string> ScalingBases { get; init; } = [];
    public Dictionary<string, double> Base { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, double> Variables { get; init; } = new(StringComparer.Ordinal);
    public MergedCoefficients Coeffs { get; init; } = new();
    public bool HasAmp { get; init; }
    public bool HasTransformative { get; init; }
    public List<MergedWarning> Warnings { get; init; } = [];
    public bool SetSensitive => true;
}

public sealed class MergedCoefficients
{
    public Dictionary<string, double> Never { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, double> Crit { get; init; } = new(StringComparer.Ordinal);
    public List<MergedAverageGroup> AvgGroups { get; init; } = [];
    public List<MergedAmplifyingGroup> AmpNever { get; init; } = [];
    public List<MergedAmplifyingGroup> AmpCrit { get; init; } = [];
    public List<MergedTransformativeGroup> Transformative { get; init; } = [];
}

public sealed class MergedAverageGroup
{
    public double CrBuff { get; init; }
    public Dictionary<string, double> Delta { get; init; } = new(StringComparer.Ordinal);
    public List<MergedAmplifyingGroup> Amp { get; init; } = [];
}

public sealed class MergedAmplifyingGroup
{
    public double EmBuff { get; init; }
    public double Bonus { get; init; }
    public Dictionary<string, double> Coeffs { get; init; } = new(StringComparer.Ordinal);
}

public sealed class MergedTransformativeGroup
{
    public double EmBuff { get; init; }
    public double Constant { get; init; }
    public double Em { get; init; }
}

public sealed class MergedWarning
{
    public string Code { get; init; } = string.Empty;
    public List<string>? Keys { get; init; }
    public string? Detail { get; init; }
}

/// <summary>
/// Evaluate an already-built merged expression at one panel. The expression is
/// the object returned by <c>POST /api/core/merged-expression</c>; the panel is
/// the same flat panel shape the axis and artifact planner use.
/// </summary>
public sealed class MergedEvaluationRequest
{
    public MergedExpressionResult? Expr { get; set; }
    public Dictionary<string, double>? Panel { get; set; }

    /// <summary>Optional pre-computed variables; takes precedence over <see cref="Panel"/>.</summary>
    public Dictionary<string, double>? Variables { get; set; }
}

public sealed class MergedEvaluationResult
{
    public Dictionary<string, double> Variables { get; init; } = new(StringComparer.Ordinal);
    public double Never { get; init; }
    public double Crit { get; init; }
    public double Avg { get; init; }
    public List<MergedAverageEvaluation> Groups { get; init; } = [];
}

/// <summary>One crit-rate-buff group evaluated at the request's panel.</summary>
public sealed class MergedAverageEvaluation
{
    public double CrBuff { get; init; }
    public double Mu { get; init; }
    public double Delta { get; init; }
    public double Amp { get; init; }
    public double Df { get; init; }
    public double Contrib { get; init; }
}
