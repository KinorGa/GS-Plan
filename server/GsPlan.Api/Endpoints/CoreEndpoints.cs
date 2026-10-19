using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;
using GsPlan.Core.Damage;
using GsPlan.Core.Stats;

namespace GsPlan.Api.Endpoints;

/// <summary>
/// Access to the pure core. The single-item routes are the parity baseline; the
/// batch routes are what the browser adapter uses so a screen full of rows
/// costs one request rather than one request per row.
/// </summary>
public static class CoreEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MaxBatchItems = 10_000;

    private sealed class DamageRequest
    {
        public DamageStats? Stats { get; set; }
        public DamageStage? Stage { get; set; }
        public DamageReaction? Reaction { get; set; }
        public string? Element { get; set; }
        public string? CritMode { get; set; }
        public double AtkLevel { get; set; } = 90;
        public double ZoneMult { get; set; } = 1;
        public double MultZone { get; set; } = 1;
        public string? Basis { get; set; } = "atk";
    }

    private sealed class DamageBatchRequest
    {
        public List<DamageRequest>? Requests { get; set; }
    }

    private sealed class DerivePanelBatchRequest
    {
        public List<DerivePanelInput>? Requests { get; set; }
    }

    public static IEndpointRouteBuilder MapCoreEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/core/meta", (HttpContext context) => ApiResults.Json(context, new
        {
            ok = true,
            service = "gs-plan-core",
            version = 1,
            batchDamage = true,
            batchDerivePanel = true,
            maxBatchItems = MaxBatchItems,
        }));

        app.MapPost("/api/core/damage", async (HttpContext context) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            DamageRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<DamageRequest>(body.Text!, JsonOptions);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }
            if (request?.Stats is null)
            {
                return ApiResults.Json(context, new { error = "stats is required" }, StatusCodes.Status400BadRequest);
            }
            return ApiResults.Json(context, ComputeDamage(request));
        });

        app.MapPost("/api/core/damage-batch", async (HttpContext context) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            DamageBatchRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<DamageBatchRequest>(body.Text!, JsonOptions);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }
            if (request?.Requests is null)
            {
                return ApiResults.Json(context, new { error = "requests is required" }, StatusCodes.Status400BadRequest);
            }
            if (request.Requests.Count > MaxBatchItems)
            {
                return ApiResults.Json(
                    context,
                    new { error = $"at most {MaxBatchItems} requests are allowed" },
                    StatusCodes.Status400BadRequest);
            }

            var results = new List<DamageResult>(request.Requests.Count);
            for (var i = 0; i < request.Requests.Count; i++)
            {
                var item = request.Requests[i];
                if (item?.Stats is null)
                {
                    return ApiResults.Json(
                        context,
                        new { error = "stats is required", index = i },
                        StatusCodes.Status400BadRequest);
                }
                results.Add(ComputeDamage(item));
            }
            return ApiResults.Json(context, new { results });
        });

        app.MapPost("/api/core/derive-panel", async (HttpContext context, StatsCatalog catalog) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            DerivePanelInput? request;
            try
            {
                request = JsonSerializer.Deserialize<DerivePanelInput>(body.Text!, JsonOptions);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }
            if (request is null)
            {
                return ApiResults.Json(context, new { error = "body is required" }, StatusCodes.Status400BadRequest);
            }

            try
            {
                var stats = request.UseStats ? catalog.Get() : null;
                return ApiResults.Json(context, StatDeriver.DerivePanel(request, stats));
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        app.MapPost("/api/core/derive-panel-batch", async (HttpContext context, StatsCatalog catalog) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            DerivePanelBatchRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<DerivePanelBatchRequest>(body.Text!, JsonOptions);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }
            if (request?.Requests is null)
            {
                return ApiResults.Json(context, new { error = "requests is required" }, StatusCodes.Status400BadRequest);
            }
            if (request.Requests.Count > MaxBatchItems)
            {
                return ApiResults.Json(
                    context,
                    new { error = $"at most {MaxBatchItems} requests are allowed" },
                    StatusCodes.Status400BadRequest);
            }

            try
            {
                StatsCompact? stats = null;
                if (request.Requests.Any(item => item?.UseStats == true)) stats = catalog.Get();
                var results = new List<DerivedPanel>(request.Requests.Count);
                for (var i = 0; i < request.Requests.Count; i++)
                {
                    var item = request.Requests[i];
                    if (item is null)
                    {
                        return ApiResults.Json(
                            context,
                            new { error = "request is required", index = i },
                            StatusCodes.Status400BadRequest);
                    }
                    results.Add(StatDeriver.DerivePanel(item, item.UseStats ? stats : null));
                }
                return ApiResults.Json(context, new { results });
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        return app;
    }

    private static DamageResult ComputeDamage(DamageRequest request)
    {
        var options = new DamageOptions
        {
            Stage = request.Stage ?? new DamageStage(),
            Reaction = request.Reaction ?? new DamageReaction(),
            Element = request.Element,
            CritMode = request.CritMode,
            AtkLevel = request.AtkLevel,
            ZoneMult = request.ZoneMult,
            MultZone = request.MultZone,
            Basis = request.Basis,
        };
        return DamageCalculator.Compute(request.Stats!, options);
    }

    private static async Task<(string? Text, IResult? Error)> ReadBodyAsync(HttpContext context)
    {
        try
        {
            return (await RequestBody.ReadTextAsync(context.Request, context.RequestAborted), null);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return (null, Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge));
        }
        catch (IOException ex) when (ex.Message.Contains("too large", StringComparison.OrdinalIgnoreCase))
        {
            return (null, Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge));
        }
        catch (Exception ex)
        {
            return (null, Results.Text(ex.Message, statusCode: StatusCodes.Status400BadRequest));
        }
    }
}
