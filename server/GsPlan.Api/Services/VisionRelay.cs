using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GsPlan.Api.Services;

public sealed class VisionRelay
{
    public const string DefaultKeyEnv = "USTC_API_KEY";

    private static readonly Regex EnvNamePattern = new(
        @"^[A-Za-z_][A-Za-z0-9_]*$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<VisionRelay> _logger;

    public VisionRelay(IHttpClientFactory httpClientFactory, ILogger<VisionRelay> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public VisionProbe Probe(string? keyEnv)
    {
        var name = KeyEnvName(keyEnv);
        return new VisionProbe(true, name, !string.IsNullOrEmpty(Environment.GetEnvironmentVariable(name)));
    }

    public static string KeyEnvName(string? keyEnv)
    {
        var name = string.IsNullOrWhiteSpace(keyEnv) ? DefaultKeyEnv : keyEnv.Trim();
        if (!EnvNamePattern.IsMatch(name))
        {
            throw new ArgumentException($"环境变量名不合法：{name}");
        }
        return name;
    }

    public static string ChatCompletionsUrl(string? baseUrl)
    {
        var value = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
        if (value.Length == 0) throw new VisionException("baseUrl is required");
        if (Regex.IsMatch(value, @"/chat/completions$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return value;
        }
        if (Regex.IsMatch(value, @"/v\d+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return value + "/chat/completions";
        }
        return value + "/v1/chat/completions";
    }

    public async Task<VisionResult> RelayAsync(VisionRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Model)) throw new VisionException("model is required");
        if (string.IsNullOrWhiteSpace(request.Image)) throw new VisionException("image is required");

        var url = ChatCompletionsUrl(request.BaseUrl);
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new VisionException($"cannot reach {url}: unsupported URL");
        }

        var name = KeyEnvName(request.KeyEnv);
        var key = Environment.GetEnvironmentVariable(name) ?? string.Empty;
        if (key.Length == 0)
        {
            _logger.LogWarning(
                "[vision] 环境变量 {KeyEnv} 没读到：本次不带 Authorization 头（本地模型不需要 Key；托管接口请在启动本服务的终端里设置它，然后重启）",
                name);
        }

        var payload = new
        {
            model = request.Model,
            temperature = 0,
            max_tokens = 2048,
            messages = new[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = request.Prompt ?? string.Empty },
                        new { type = "image_url", image_url = new { url = request.Image } },
                    },
                },
            },
        };

        using var client = _httpClientFactory.CreateClient("vision");
        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        if (key.Length > 0)
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        }

        HttpResponseMessage upstream;
        try
        {
            upstream = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new VisionException($"cannot reach {url}: {ex.Message}");
        }

        using (upstream)
        {
            var raw = await upstream.Content.ReadAsStringAsync(cancellationToken);
            using var document = TryParse(raw);

            if (!upstream.IsSuccessStatusCode)
            {
                var detail = Detail(document, raw, upstream.ReasonPhrase ?? string.Empty);
                throw new VisionException($"{(int)upstream.StatusCode} {detail}");
            }

            if (document is null || !TryGetText(document.RootElement, out var text))
            {
                throw new VisionException("the reply had no choices[0].message.content");
            }

            return new VisionResult(text, GetModel(document.RootElement) ?? request.Model!);
        }
    }

    private static JsonDocument? TryParse(string raw)
    {
        try
        {
            return JsonDocument.Parse(raw);
        }
        catch
        {
            return null;
        }
    }

    private static bool TryGetText(JsonElement root, out string text)
    {
        text = string.Empty;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("choices", out var choices)
            || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0)
        {
            return false;
        }

        var first = choices[0];
        if (first.ValueKind != JsonValueKind.Object
            || !first.TryGetProperty("message", out var message)
            || message.ValueKind != JsonValueKind.Object
            || !message.TryGetProperty("content", out var content)
            || content.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        text = content.GetString() ?? string.Empty;
        return true;
    }

    private static string? GetModel(JsonElement root)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("model", out var model)
            && model.ValueKind == JsonValueKind.String
            ? model.GetString()
            : null;
    }

    private static string Detail(JsonDocument? document, string raw, string fallback)
    {
        if (document is not null && document.RootElement.ValueKind == JsonValueKind.Object)
        {
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var error))
            {
                if (error.ValueKind == JsonValueKind.Object
                    && error.TryGetProperty("message", out var message)
                    && message.ValueKind == JsonValueKind.String)
                {
                    return message.GetString() ?? fallback;
                }
                if (error.ValueKind == JsonValueKind.String)
                {
                    return error.GetString() ?? fallback;
                }
                return error.GetRawText();
            }
            if (root.TryGetProperty("message", out var top) && top.ValueKind == JsonValueKind.String)
            {
                return top.GetString() ?? fallback;
            }
        }

        if (!string.IsNullOrWhiteSpace(raw))
        {
            return raw.Length <= 300 ? raw : raw[..300];
        }
        return fallback;
    }
}

public sealed record VisionRequest(string? BaseUrl, string? KeyEnv, string? Model, string? Image, string? Prompt);

public sealed record VisionResult(string Text, string Model);

public sealed record VisionProbe(bool Ok, string KeyEnv, bool KeyPresent);

public sealed class VisionException : Exception
{
    public VisionException(string message) : base(message) { }
}
