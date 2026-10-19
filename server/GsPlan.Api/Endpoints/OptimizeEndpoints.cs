using System.Globalization;
using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;

namespace GsPlan.Api.Endpoints;

public static class OptimizeEndpoints
{
    public static IEndpointRouteBuilder MapOptimizeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/optimize", async (HttpContext context, OptimizerRunner runner) =>
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
                if (document.RootElement.ValueKind != JsonValueKind.Object
                    || !document.RootElement.TryGetProperty("problem", out var problem)
                    || problem.ValueKind != JsonValueKind.String
                    || string.IsNullOrWhiteSpace(problem.GetString()))
                {
                    return ApiResults.Json(context, new { error = "problem is required" }, StatusCodes.Status400BadRequest);
                }

                try
                {
                    var result = await runner.RunAsync(problem.GetString()!, context.RequestAborted);
                    context.Response.Headers["X-Optimize-Ms"] =
                        result.ElapsedMs.ToString("0.0", CultureInfo.InvariantCulture);
                    context.Response.Headers.CacheControl = "no-store";
                    return Results.Text(result.Csv, "text/plain; charset=utf-8");
                }
                catch (OptimizerUnavailableException ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status501NotImplemented);
                }
                catch (OptimizerTimeoutException ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
                }
                catch (OptimizerStartException ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
                }
                catch (OptimizerFailedException ex)
                {
                    var detail = string.IsNullOrWhiteSpace(ex.StandardError) ? "没有输出" : ex.StandardError.Trim();
                    return ApiResults.Json(context, new { error = $"优化器退出码 {ex.ExitCode}：{detail}" }, StatusCodes.Status500InternalServerError);
                }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
                }
            }
        });

        return app;
    }
}
