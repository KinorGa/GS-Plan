using System.Globalization;
using System.Text.RegularExpressions;

namespace GsPlan.Core.Axis;

/// <summary>One selectable <c>$</c> symbol.</summary>
public sealed record FormulaSymbol(string Name, string En, string Key, string Kind);

public sealed record FormulaIdentity(
    double Level = 0,
    double Constellation = 0,
    double TalentNormal = 0,
    double TalentSkill = 0,
    double TalentBurst = 0,
    double Refine = 0,
    double Rarity = 0);

public sealed class FormulaAnalysis
{
    public bool Ok { get; init; }
    public List<string> Symbols { get; init; } = [];
    public string? Error { get; init; }
    public int At { get; init; }
    internal FormulaNode? Tree { get; init; }
}

public sealed class FormulaResult
{
    public bool Ok { get; init; }
    public double? Value { get; init; }
    public string? Error { get; init; }
    public List<string> Unknown { get; init; } = [];
}

public abstract record FormulaNode;
public sealed record FormulaNumber(double Value) : FormulaNode;
public sealed record FormulaSymbolNode(string Name) : FormulaNode;
public sealed record FormulaUnary(string Op, FormulaNode Value) : FormulaNode;
public sealed record FormulaBinary(string Op, FormulaNode Left, FormulaNode Right) : FormulaNode;

/// <summary>
/// Formula-valued buffs, scoped to the owner character's own panel. Ported from
/// <c>src/lib/buff-formula.js</c>: the same tokenizer, precedence, symbols,
/// error messages and refusal to reduce an unresolved formula to a number.
/// </summary>
public static partial class BuffFormula
{
    private static readonly IReadOnlyList<FormulaSymbol> FormulaSymbols = BuildSymbols();

    public static IReadOnlyList<FormulaSymbol> Symbols => FormulaSymbols;

    public static FormulaSymbol? SymbolByName(string? name)
        => name is null ? null : FormulaSymbols.FirstOrDefault(symbol => symbol.Name == name);

    public static bool IsFormula(string? value)
        => value is not null && value.TrimStart().StartsWith('=');

    /// <summary>What a formula reads, without evaluating it.</summary>
    public static FormulaAnalysis Analyse(string? text)
    {
        var source = (text ?? string.Empty).TrimStart();
        if (source.StartsWith('=')) source = source[1..];
        if (source.Length == 0)
        {
            return new FormulaAnalysis { Ok = false, Error = "空公式" };
        }
        try
        {
            var tree = Parse(Tokenize(source));
            var symbols = new List<string>();
            Walk(tree, symbols);
            var unique = new List<string>();
            foreach (var symbol in symbols)
            {
                if (!unique.Contains(symbol)) unique.Add(symbol);
            }
            return new FormulaAnalysis { Ok = true, Tree = tree, Symbols = unique };
        }
        catch (FormulaError error)
        {
            return new FormulaAnalysis { Ok = false, Error = error.Message, At = error.At };
        }
    }

    /// <summary>Evaluate a formula against a closed scope.</summary>
    public static FormulaResult Evaluate(
        string? text,
        IReadOnlyDictionary<string, double>? scope)
    {
        var analysis = Analyse(text);
        if (!analysis.Ok)
        {
            return new FormulaResult { Ok = false, Error = analysis.Error };
        }
        var values = scope ?? new Dictionary<string, double>(StringComparer.Ordinal);
        var unknown = analysis.Symbols.Where(name => !values.ContainsKey(name)).ToList();
        if (unknown.Count > 0)
        {
            return new FormulaResult
            {
                Ok = false,
                Error = "不认识的符号：" + string.Join("、", unknown),
                Unknown = unknown,
            };
        }
        try
        {
            var value = Run(analysis.Tree!, values);
            if (!double.IsFinite(value))
            {
                return new FormulaResult { Ok = false, Error = "结果不是有限数" };
            }
            return new FormulaResult { Ok = true, Value = value };
        }
        catch (FormulaError error)
        {
            return new FormulaResult { Ok = false, Error = error.Message };
        }
    }

    /// <summary>A plain number, as a result: clean digits, or an error.</summary>
    public static FormulaResult PlainNumber(string? text)
    {
        var source = (text ?? string.Empty).Trim();
        if (source.Length == 0) return new FormulaResult { Ok = true, Value = 0 };
        if (!PlainNumberRegex().IsMatch(source))
        {
            return new FormulaResult { Ok = false, Error = "不是合法的数字：" + text };
        }
        if (!double.TryParse(source, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            || !double.IsFinite(value))
        {
            return new FormulaResult { Ok = false, Error = "结果不是有限数" };
        }
        return new FormulaResult { Ok = true, Value = value };
    }

    public static FormulaResult Resolve(
        string? text,
        IReadOnlyDictionary<string, double>? scope)
        => IsFormula(text) ? Evaluate(text, scope) : PlainNumber(text);

    public static double ValueOf(
        string? text,
        IReadOnlyDictionary<string, double>? scope)
    {
        var result = Resolve(text, scope);
        return result.Ok ? result.Value ?? 0 : double.NaN;
    }

    /// <summary>The <c>$partial</c> the caret sits in, or null.</summary>
    public static (int From, int To, string Text)? PartialAt(string? value, int caret)
    {
        var source = value ?? string.Empty;
        var upto = source[..Math.Clamp(caret, 0, source.Length)];
        var dollar = upto.LastIndexOf('$');
        if (dollar < 0) return null;
        var fragment = upto[(dollar + 1)..];
        if (FragmentEndRegex().IsMatch(fragment)) return null;
        return (dollar, caret, fragment);
    }

    /// <summary>The symbols matching a fragment, in the table's order.</summary>
    public static List<FormulaSymbolMatch> MatchesFor(
        string? fragment,
        IReadOnlyDictionary<string, double>? scope)
    {
        var needle = fragment ?? string.Empty;
        var values = scope ?? new Dictionary<string, double>(StringComparer.Ordinal);
        return FormulaSymbols
            .Where(symbol => symbol.Name.StartsWith(needle, StringComparison.Ordinal))
            .Select(symbol => new FormulaSymbolMatch(
                symbol.Name,
                symbol.En,
                symbol.Kind,
                values.TryGetValue(symbol.Name, out var value) ? value : 0))
            .ToList();
    }

    /// <summary>The closed scope from a derived panel and a unit identity.</summary>
    public static Dictionary<string, double> ScopeFor(
        IReadOnlyDictionary<string, double>? panel,
        FormulaIdentity identity)
    {
        var values = panel ?? new Dictionary<string, double>(StringComparer.Ordinal);
        var scope = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var symbol in FormulaSymbols)
        {
            if (symbol.Kind == "panel") scope[symbol.Name] = values.GetValueOrDefault(symbol.Key);
            else if (symbol.Kind == "total") scope[symbol.Name] = Total(values, symbol.Key);
            else scope[symbol.Name] = 0;
        }
        scope["等级"] = identity.Level;
        scope["命座"] = identity.Constellation;
        scope["普通攻击等级"] = identity.TalentNormal;
        scope["元素战技等级"] = identity.TalentSkill;
        scope["元素爆发等级"] = identity.TalentBurst;
        scope["精炼"] = identity.Refine;
        scope["稀有度"] = identity.Rarity;
        return scope;
    }

    private static double Total(IReadOnlyDictionary<string, double> panel, string key)
        => panel.GetValueOrDefault(key) * (1 + panel.GetValueOrDefault(key + "Pct") / 100)
            + panel.GetValueOrDefault("flat" + char.ToUpperInvariant(key[0]) + key[1..]);

    private static void Walk(FormulaNode? node, List<string> symbols)
    {
        switch (node)
        {
            case FormulaSymbolNode symbol:
                symbols.Add(symbol.Name);
                break;
            case FormulaUnary unary:
                Walk(unary.Value, symbols);
                break;
            case FormulaBinary binary:
                Walk(binary.Left, symbols);
                Walk(binary.Right, symbols);
                break;
        }
    }

    private static double Run(FormulaNode node, IReadOnlyDictionary<string, double> scope)
    {
        return node switch
        {
            FormulaNumber number => number.Value,
            FormulaSymbolNode symbol => scope[symbol.Name],
            FormulaUnary { Op: "neg" } unary => -Run(unary.Value, scope),
            FormulaBinary binary => binary.Op switch
            {
                "+" => Run(binary.Left, scope) + Run(binary.Right, scope),
                "-" => Run(binary.Left, scope) - Run(binary.Right, scope),
                "*" => Run(binary.Left, scope) * Run(binary.Right, scope),
                "/" => Divide(binary, scope),
                _ => throw new FormulaError("无法计算的表达式"),
            },
            _ => throw new FormulaError("无法计算的表达式"),
        };
    }

    private static double Divide(FormulaBinary binary, IReadOnlyDictionary<string, double> scope)
    {
        var divisor = Run(binary.Right, scope);
        if (divisor == 0) throw new FormulaError("除以零");
        return Run(binary.Left, scope) / divisor;
    }

    private static List<Token> Tokenize(string source)
    {
        var tokens = new List<Token>();
        var index = 0;
        while (index < source.Length)
        {
            var c = source[index];
            if (c is ' ' or '\t' or '\n')
            {
                index++;
                continue;
            }
            if ("+-*/()".Contains(c))
            {
                tokens.Add(new Token(c.ToString(), c.ToString(), 0, 0, index));
                index++;
                continue;
            }
            if (c is >= '0' and <= '9' or '.')
            {
                var start = index;
                while (index < source.Length && (source[index] is >= '0' and <= '9' or '.')) index++;
                var text = source[start..index];
                if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                    || !double.IsFinite(number))
                {
                    throw new FormulaError("不是合法的数字：" + text, start);
                }
                tokens.Add(new Token("num", string.Empty, number, start, start));
                continue;
            }
            if (c == '$')
            {
                var start = index;
                index++;
                var nameStart = index;
                while (index < source.Length && !"+-*/() \t\n".Contains(source[index])) index++;
                var name = source[nameStart..index];
                if (name.Length == 0) throw new FormulaError("$ 后面缺少名字", start);
                tokens.Add(new Token("sym", name, 0, start, start));
                continue;
            }
            throw new FormulaError("不认识的字符：" + c, index);
        }
        return tokens;
    }

    private static FormulaNode Parse(List<Token> tokens)
    {
        var position = 0;
        Token? Peek() => position < tokens.Count ? tokens[position] : null;
        bool Eat(string kind)
        {
            if (position >= tokens.Count || tokens[position].Kind != kind) return false;
            position++;
            return true;
        }

        FormulaNode Expr()
        {
            var left = Term();
            while (true)
            {
                if (Eat("+")) left = new FormulaBinary("+", left, Term());
                else if (Eat("-")) left = new FormulaBinary("-", left, Term());
                else return left;
            }
        }
        FormulaNode Term()
        {
            var left = Unary();
            while (true)
            {
                if (Eat("*")) left = new FormulaBinary("*", left, Unary());
                else if (Eat("/")) left = new FormulaBinary("/", left, Unary());
                else return left;
            }
        }
        FormulaNode Unary()
        {
            if (Eat("-")) return new FormulaUnary("neg", Unary());
            if (Eat("+")) return Unary();
            return Atom();
        }
        FormulaNode Atom()
        {
            var token = Peek();
            if (token is not { } current) throw new FormulaError("公式不完整", 0);
            if (current.Kind == "num")
            {
                position++;
                return new FormulaNumber(current.Number);
            }
            if (current.Kind == "sym")
            {
                position++;
                return new FormulaSymbolNode(current.Name);
            }
            if (current.Kind == "(")
            {
                position++;
                var inner = Expr();
                if (!Eat(")")) throw new FormulaError("缺少右括号", current.At);
                return inner;
            }
            throw new FormulaError("这里不该出现 " + current.Kind, current.At);
        }

        var tree = Expr();
        if (position < tokens.Count) throw new FormulaError("公式末尾有多余内容", tokens[position].At);
        return tree;
    }

    private static IReadOnlyList<FormulaSymbol> BuildSymbols()
    {
        var english = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["hp"] = "HP", ["atk"] = "ATK", ["def"] = "DEF",
            ["flatHp"] = "Flat HP", ["flatAtk"] = "Flat ATK", ["flatDef"] = "Flat DEF",
            ["hpPct"] = "HP%", ["atkPct"] = "ATK%", ["defPct"] = "DEF%",
            ["em"] = "Elemental Mastery", ["critRate"] = "CRIT Rate", ["critDmg"] = "CRIT DMG",
            ["er"] = "Energy Recharge", ["pyroDmg"] = "Pyro DMG", ["hydroDmg"] = "Hydro DMG",
            ["cryoDmg"] = "Cryo DMG", ["electroDmg"] = "Electro DMG", ["anemoDmg"] = "Anemo DMG",
            ["geoDmg"] = "Geo DMG", ["dendroDmg"] = "Dendro DMG", ["dmgBonus"] = "All DMG Bonus",
            ["physBonus"] = "Physical DMG Bonus", ["healBonus"] = "Healing Bonus",
        };
        var symbols = new List<FormulaSymbol>();
        foreach (var (key, name) in AxisPanelStats.PanelSymbols)
        {
            symbols.Add(new FormulaSymbol(name, english.GetValueOrDefault(key, key), key, "panel"));
        }
        symbols.Add(new FormulaSymbol("总生命值", "Total HP", "hp", "total"));
        symbols.Add(new FormulaSymbol("总攻击力", "Total ATK", "atk", "total"));
        symbols.Add(new FormulaSymbol("总防御力", "Total DEF", "def", "total"));
        symbols.Add(new FormulaSymbol("等级", "Level", "level", "identity"));
        symbols.Add(new FormulaSymbol("命座", "Constellation", "constellation", "identity"));
        symbols.Add(new FormulaSymbol("普通攻击等级", "Normal ATK Lv", "talentNormal", "identity"));
        symbols.Add(new FormulaSymbol("元素战技等级", "Skill Lv", "talentSkill", "identity"));
        symbols.Add(new FormulaSymbol("元素爆发等级", "Burst Lv", "talentBurst", "identity"));
        symbols.Add(new FormulaSymbol("精炼", "Refinement", "refine", "identity"));
        symbols.Add(new FormulaSymbol("稀有度", "Rarity", "rarity", "identity"));
        return symbols;
    }

    private readonly record struct Token(
        string Kind,
        string Name,
        double Number,
        int At,
        int End);

    private sealed class FormulaError(string message, int at = 0) : Exception(message)
    {
        public int At { get; } = at;
    }

    public sealed record FormulaSymbolMatch(string Name, string En, string Kind, double Value);

    [GeneratedRegex("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)$", RegexOptions.CultureInvariant)]
    private static partial Regex PlainNumberRegex();

    [GeneratedRegex("[+*\\/() \\t\\n-]", RegexOptions.CultureInvariant)]
    private static partial Regex FragmentEndRegex();
}
