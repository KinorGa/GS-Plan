using System.Collections.Concurrent;
using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;
using GsPlan.Core.Artifacts;

namespace GsPlan.Api.Endpoints;

/// <summary>
/// The screenshot scan's pure half: the model reply arrives as text, the
/// service returns the same review rows the browser fallback builds.
/// </summary>
public static class ArtifactScanEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<string, ArtifactScanCatalogue> Catalogues =
        new(StringComparer.Ordinal);

    private sealed class ScanRequest
    {
        public string? Reply { get; set; }
    }

    public static IEndpointRouteBuilder MapArtifactScanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/artifact/scan", async (HttpContext context, CoreDataCatalog catalog) =>
        {
            string body;
            try
            {
                body = await RequestBody.ReadTextAsync(context.Request, context.RequestAborted);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                return ApiResults.Json(context, new { error = "body too large" }, StatusCodes.Status413PayloadTooLarge);
            }
            catch (IOException ex) when (ex.Message.Contains("too large", StringComparison.OrdinalIgnoreCase))
            {
                return ApiResults.Json(context, new { error = "body too large" }, StatusCodes.Status413PayloadTooLarge);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }

            ScanRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<ScanRequest>(body, JsonOptions);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }
            if (string.IsNullOrWhiteSpace(request?.Reply))
            {
                return ApiResults.Json(context, new { error = "reply is required" }, StatusCodes.Status400BadRequest);
            }

            var index = catalog.ArtifactCatalogue;
            if (index is null)
            {
                return ApiResults.Json(
                    context,
                    new { error = "artifact catalogue is not available on the service" },
                    StatusCodes.Status500InternalServerError);
            }

            var lang = context.Request.Query["lang"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(lang)) lang = "chs";
            try
            {
                var catalogue = Catalogues.GetOrAdd(
                    lang,
                    value => ArtifactScan.BuildCatalogue(
                        index.Value,
                        id => catalog.GetArtifactDetail(value, id)));
                var pieces = ArtifactScan.ParseResponse(request.Reply);
                return ApiResults.Json(context, new { rows = ArtifactScan.BuildRows(pieces, catalogue) });
            }
            catch (ArtifactScanException ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        return app;
    }
}
