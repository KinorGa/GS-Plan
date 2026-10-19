using System.Text;
using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;

namespace GsPlan.Api.Endpoints;

public static class DataEndpoints
{
    public static IEndpointRouteBuilder MapDataEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/data", async (HttpContext context, DataStore store) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            try
            {
                var body = await store.ReadAsync(context.RequestAborted) ?? "{}";
                return Results.Text(body, "application/json; charset=utf-8");
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        app.MapMethods("/api/data", new[] { "PUT", "POST" }, async (HttpContext context, DataStore store) =>
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

            try
            {
                using var document = JsonDocument.Parse(body);
            }
            catch (JsonException)
            {
                return ApiResults.Json(context, new { error = "body is not JSON" }, StatusCodes.Status400BadRequest);
            }

            try
            {
                await store.WriteAsync(body, context.RequestAborted);
                return ApiResults.Json(context, new { ok = true, bytes = Encoding.UTF8.GetByteCount(body) });
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        return app;
    }
}
