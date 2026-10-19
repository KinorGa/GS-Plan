using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;

namespace GsPlan.Api.Endpoints;

public static class VisionEndpoints
{
    public static IEndpointRouteBuilder MapVisionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/vision", (HttpContext context, VisionRelay relay) =>
        {
            try
            {
                return ApiResults.Json(context, relay.Probe(context.Request.Query["keyEnv"].ToString()));
            }
            catch (ArgumentException ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }
        });

        app.MapPost("/api/vision", async (HttpContext context, VisionRelay relay) =>
        {
            string body;
            try
            {
                body = await RequestBody.ReadTextAsync(context.Request, context.RequestAborted);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                return Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge);
            }
            catch (IOException ex) when (ex.Message.Contains("too large", StringComparison.OrdinalIgnoreCase))
            {
                return Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge);
            }
            catch (Exception ex)
            {
                return Results.Text(ex.Message, statusCode: StatusCodes.Status400BadRequest);
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(body);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }

            using (document)
            {
                var root = document.RootElement;
                var request = new VisionRequest(
                    GetString(root, "baseUrl"),
                    GetString(root, "keyEnv"),
                    GetString(root, "model"),
                    GetString(root, "image"),
                    GetString(root, "prompt") ?? string.Empty);

                try
                {
                    var result = await relay.RelayAsync(request, context.RequestAborted);
                    return ApiResults.Json(context, new { text = result.Text, model = result.Model });
                }
                catch (VisionException ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status502BadGateway);
                }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status502BadGateway);
                }
            }
        });

        return app;
    }

    private static string? GetString(JsonElement root, string name)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}
