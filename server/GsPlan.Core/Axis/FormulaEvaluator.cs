using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GsPlan.Core.Axis;

/// <summary>
/// Resolves a buff value that is either a plain number or a closed-scope formula
/// such as <c>=$总攻击力*0.15</c>. Ported from <c>src/lib/buff-formula.js</c>.
/// </summary>
public static partial class FormulaEvaluator
{
    private static readonly IReadOnlyDictionary<string, double> EmptyScope =
        new Dictionary<string, double>(StringComparer.Ordinal);

    public static bool IsFormula(string? value)
        => value is not null && value.TrimStart().StartsWith('=');

    public static double NumericValue(JsonElement value, IReadOnlyDictionary<string, double>? scope)
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

        if (IsFormula(text)) return TryEvaluate(text, scope ?? EmptyScope, out result);

        var trimmed = text.Trim();
        if (trimmed.Length == 0)
        {
            result = 0;
            return true;
        }
        if (!PlainNumber().IsMatch(trimmed)) return false;
        if (!double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
        {
            return false;
        }
        if (!double.IsFinite(parsed)) return false;
        result = parsed;
        return true;
    }

    private static bool TryEvaluate(
        string formula,
        IReadOnlyDictionary<string, double> scope,
        out double result)
    {
        result = 0;
        var source = formula.TrimStart();
        if (source.StartsWith('=')) source = source[1..];
        try
        {
            var tokens = Tokenize(source);
            var parser = new Parser(tokens, scope);
            result = parser.Parse();
            return double.IsFinite(result);
        }
        catch
        {
            result = 0;
            return false;
        }
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
            if (c is '+' or '-' or '*' or '/' or '(' or ')')
            {
                tokens.Add(new Token(c switch
                {
                    '+' => TokenKind.Plus,
                    '-' => TokenKind.Minus,
                    '*' => TokenKind.Star,
                    '/' => TokenKind.Slash,
                    '(' => TokenKind.LeftParen,
                    _ => TokenKind.RightParen,
                }));
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
                    throw new FormulaException("invalid number");
                }
                tokens.Add(new Token(TokenKind.Number, number, null));
                continue;
            }
            if (c == '$')
            {
                var start = ++index;
                while (index < source.Length && source[index] is not ('+' or '-' or '*' or '/' or '(' or ')' or ' ' or '\t' or '\n'))
                {
                    index++;
                }
                var name = source[start..index];
                if (name.Length == 0) throw new FormulaException("missing symbol name");
                tokens.Add(new Token(TokenKind.Symbol, 0, name));
                continue;
            }
            throw new FormulaException("unknown character");
        }
        return tokens;
    }

    private sealed class Parser
    {
        private readonly List<Token> _tokens;
        private readonly IReadOnlyDictionary<string, double> _scope;
        private int _position;

        public Parser(List<Token> tokens, IReadOnlyDictionary<string, double> scope)
        {
            _tokens = tokens;
            _scope = scope;
        }

        public double Parse()
        {
            var value = Expression();
            if (_position != _tokens.Count) throw new FormulaException("trailing tokens");
            return value;
        }

        private double Expression()
        {
            var value = Term();
            while (true)
            {
                if (Eat(TokenKind.Plus)) value += Term();
                else if (Eat(TokenKind.Minus)) value -= Term();
                else return value;
            }
        }

        private double Term()
        {
            var value = Unary();
            while (true)
            {
                if (Eat(TokenKind.Star))
                {
                    value *= Unary();
                }
                else if (Eat(TokenKind.Slash))
                {
                    var divisor = Unary();
                    if (divisor == 0) throw new FormulaException("division by zero");
                    value /= divisor;
                }
                else
                {
                    return value;
                }
            }
        }

        private double Unary()
        {
            if (Eat(TokenKind.Minus)) return -Unary();
            if (Eat(TokenKind.Plus)) return Unary();
            return Atom();
        }

        private double Atom()
        {
            if (_position >= _tokens.Count) throw new FormulaException("incomplete formula");
            var token = _tokens[_position++];
            if (token.Kind == TokenKind.Number) return token.Number;
            if (token.Kind == TokenKind.Symbol)
            {
                var name = token.Name ?? string.Empty;
                if (!_scope.TryGetValue(name, out var value))
                {
                    throw new FormulaException("unknown symbol");
                }
                return value;
            }
            if (token.Kind == TokenKind.LeftParen)
            {
                var value = Expression();
                if (!Eat(TokenKind.RightParen)) throw new FormulaException("missing right parenthesis");
                return value;
            }
            throw new FormulaException("unexpected token");
        }

        private bool Eat(TokenKind kind)
        {
            if (_position >= _tokens.Count || _tokens[_position].Kind != kind) return false;
            _position++;
            return true;
        }
    }

    private enum TokenKind
    {
        Number,
        Symbol,
        Plus,
        Minus,
        Star,
        Slash,
        LeftParen,
        RightParen,
    }

    private readonly record struct Token(TokenKind Kind, double Number = 0, string? Name = null);

    private sealed class FormulaException(string message) : Exception(message);

    [GeneratedRegex("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)$", RegexOptions.CultureInvariant)]
    private static partial Regex PlainNumber();
}
