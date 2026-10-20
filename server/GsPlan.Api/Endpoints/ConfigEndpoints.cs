using System.Text.Json;
using System.Text.Json.Nodes;
using GsPlan.Api.Infrastructure;
using GsPlan.Core.Config;

namespace GsPlan.Api.Endpoints;

/// <summary>
/// The configuration file boundary. The browser still owns the local document;
/// these routes keep export and import on the same normalisation rules as the
/// planner instead of maintaining a second, drifting interpretation.
/// </summary>
public static class ConfigEndpoints
{
    public static IEndpointRouteBuilder MapConfigEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/config/export", async (HttpContext context) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            JsonObject request;
            try
            {
                if (JsonNode.Parse(body.Text!) is not JsonObject parsed)
                {
                    return ApiResults.Json(context, new { error = "body must be a JSON object" }, StatusCodes.Status400BadRequest);
                }
                request = parsed;
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }

            try
            {
                var text = ConfigDocument.BuildText(request["team"], request["axes"], request["activeId"]);
                context.Response.Headers.CacheControl = "no-store";
                return Results.Text(text, "application/json; charset=utf-8");
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        app.MapPost("/api/config/import", async (HttpContext context) =>
        {
            var body = await ReadBodyAsync(context);
            if (body.Error is not null) return body.Error;

            string text;
            try
            {
                if (JsonNode.Parse(body.Text!) is not JsonObject wrapper
                    || wrapper["text"] is not JsonValue value
                    || !value.TryGetValue<string>(out var supplied)
                    || string.IsNullOrWhiteSpace(supplied))
                {
                    return ApiResults.Json(context, new { error = "text is required" }, StatusCodes.Status400BadRequest);
                }
                text = supplied;
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }

            try
            {
                var parsed = ConfigDocument.Parse(text);
                return ApiResults.Json(context, new
                {
                    team = parsed["team"],
                    axes = parsed["axes"],
                    activeId = parsed["activeId"],
                    teamOnly = parsed["teamOnly"]?.GetValue<bool>() ?? false,
                });
            }
            catch (ConfigDocumentException ex)
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
