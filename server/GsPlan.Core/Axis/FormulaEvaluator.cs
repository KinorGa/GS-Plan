using System.Text.Json;

namespace GsPlan.Core.Axis;

/// <summary>
/// Resolves a buff value that is either a plain number or a closed-scope formula.
/// The parser and symbol rules live in <see cref="BuffFormula"/>; this thin
/// adapter keeps the axis's existing "unresolved is zero" contract.
/// </summary>
public static class FormulaEvaluator
{
    public static bool IsFormula(string? value) => BuffFormula.IsFormula(value);

    public static double NumericValue(
        JsonElement value,
        IReadOnlyDictionary<string, double>? scope)
        => TryResolve(value, scope, out var number) ? number : 0;

    public static bool TryResolve(
        JsonElement value,
        IReadOnlyDictionary<string, double>? scope,
        out double result)
    {
        result = 0;
        if (value.ValueKind == JsonValueKind.Number)
        {
            var numeric = value.GetDouble();
            if (!double.IsFinite(numeric)) return false;
            result = numeric;
            return true;
        }
        if (value.ValueKind != JsonValueKind.String) return false;
        var text = value.GetString();
        if (text is null) return false;
        var resolved = BuffFormula.Resolve(text, scope);
        if (!resolved.Ok || resolved.Value is null) return false;
        result = resolved.Value.Value;
        return true;
    }
}
