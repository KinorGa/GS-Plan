using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;
using GsPlan.Core.Damage;
using GsPlan.Core.Stats;

namespace GsPlan.Api.Endpoints;

/// <summary>
/// Test-facing access to the pure core. Phase 2 does not route the existing UI
/// through these endpoints yet; parity tests call them directly against the JS
/// modules so both implementations stay honest while the migration is staged.
/// </summary>
public static class CoreEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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

    public static IEndpointRouteBuilder MapCoreEndpoints(this IEndpointRouteBuilder app)
    {
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
            return ApiResults.Json(context, DamageCalculator.Compute(request.Stats, options));
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

        return app;
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
