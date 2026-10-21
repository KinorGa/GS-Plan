using System.Globalization;
using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;
using GsPlan.Core.Artifacts;

namespace GsPlan.Api.Endpoints;

public static class OptimizeEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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

        app.MapPost("/api/optimize/artifact/problem", async (HttpContext context) =>
        {
            var (request, error) = await ReadJsonAsync<ArtifactOptimizeRequest>(context);
            if (error is not null) return error;
            if (!ValidArtifactRequest(request, out var invalid))
            {
                return ApiResults.Json(
                    context,
                    new { error = invalid },
                    StatusCodes.Status400BadRequest);
            }

            try
            {
                var problem = ArtifactOptimizeCalculator.BuildProblem(request!);
                context.Response.Headers.CacheControl = "no-store";
                return Results.Text(problem, "text/plain; charset=utf-8");
            }
            catch (InvalidOperationException ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        app.MapPost("/api/optimize/artifact/parse", async (HttpContext context) =>
        {
            var (request, error) = await ReadJsonAsync<ArtifactParseRequest>(context);
            if (error is not null) return error;
            if (request?.Csv is null)
            {
                return ApiResults.Json(
                    context,
                    new { error = "csv is required" },
                    StatusCodes.Status400BadRequest);
            }

            try
            {
                var parsed = ArtifactOptimizeCalculator.ParseResult(request.Csv);
                context.Response.Headers.CacheControl = "no-store";
                return ApiResults.Json(context, parsed);
            }
            catch (InvalidOperationException ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }
        });

        app.MapPost("/api/optimize/artifact", async (HttpContext context, OptimizerRunner runner) =>
        {
            var (request, error) = await ReadJsonAsync<ArtifactOptimizeRequest>(context);
            if (error is not null) return error;
            if (!ValidArtifactRequest(request, out var invalid))
            {
                return ApiResults.Json(
                    context,
                    new { error = invalid },
                    StatusCodes.Status400BadRequest);
            }

            string problem;
            try
            {
                problem = ArtifactOptimizeCalculator.BuildProblem(request!);
            }
            catch (InvalidOperationException ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status400BadRequest);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(context, new { error = ex.Message }, StatusCodes.Status500InternalServerError);
            }

            try
            {
                var result = await runner.RunAsync(problem, context.RequestAborted);
                var parsed = ArtifactOptimizeCalculator.ParseResult(result.Csv);
                context.Response.Headers["X-Optimize-Ms"] =
                    result.ElapsedMs.ToString("0.0", CultureInfo.InvariantCulture);
                context.Response.Headers.CacheControl = "no-store";
                return ApiResults.Json(context, new ArtifactOptimizeResult
                {
                    Problem = problem,
                    Stats = parsed.Stats,
                    Rows = parsed.Rows,
                    ElapsedMs = result.ElapsedMs,
                });
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                return OptimizerFailure(context, ex);
            }
        });

        app.MapPost("/api/optimize/artifact/plan", async (HttpContext context) =>
        {
            var (request, error) = await ReadJsonAsync<ArtifactPlanRequest>(context);
            if (error is not null) return error;
            if (request?.Expr is null)
            {
                return ApiResults.Json(context, new { error = "expr is required" }, StatusCodes.Status400BadRequest);
            }

            try
            {
                var plan = ArtifactOptimizePlanner.Plan(request);
                context.Response.Headers.CacheControl = "no-store";
                return ApiResults.Json(context, plan);
            }
            catch (InvalidOperationException ex)
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

    private static async Task<(T? Value, IResult? Error)> ReadJsonAsync<T>(HttpContext context)
    {
        string body;
        try
        {
            body = await RequestBody.ReadTextAsync(context.Request, context.RequestAborted);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return (default, Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge));
        }
        catch (IOException ex) when (ex.Message.Contains("too large", StringComparison.OrdinalIgnoreCase))
        {
            return (default, Results.Text("body too large", statusCode: StatusCodes.Status413PayloadTooLarge));
        }
        catch (Exception ex)
        {
            return (default, Results.Text(ex.Message, statusCode: StatusCodes.Status400BadRequest));
        }

        try
        {
            return (JsonSerializer.Deserialize<T>(body, JsonOptions), null);
        }
        catch (JsonException)
        {
            return (default, ApiResults.Json(
                context,
                new { error = "body is not JSON" },
                StatusCodes.Status400BadRequest));
        }
    }

    private static bool ValidArtifactRequest(
        ArtifactOptimizeRequest? request,
        out string error)
    {
        if (request is null)
        {
            error = "body is required";
            return false;
        }
        if (request.Coeffs is null)
        {
            error = "coeffs is required";
            return false;
        }
        if (request.Pieces is null || request.Pieces.Count == 0)
        {
            error = "pieces are required";
            return false;
        }
        error = string.Empty;
        return true;
    }

    private static IResult OptimizerFailure(HttpContext context, Exception ex)
    {
        return ex switch
        {
            OptimizerUnavailableException unavailable => ApiResults.Json(
                context,
                new { error = unavailable.Message },
                StatusCodes.Status501NotImplemented),
            OptimizerTimeoutException timeout => ApiResults.Json(
                context,
                new { error = timeout.Message },
                StatusCodes.Status500InternalServerError),
            OptimizerStartException start => ApiResults.Json(
                context,
                new { error = start.Message },
                StatusCodes.Status500InternalServerError),
            OptimizerFailedException failed => ApiResults.Json(
                context,
                new
                {
                    error = $"优化器退出码 {failed.ExitCode}："
                        + (string.IsNullOrWhiteSpace(failed.StandardError) ? "没有输出" : failed.StandardError.Trim()),
                },
                StatusCodes.Status500InternalServerError),
            _ => ApiResults.Json(
                context,
                new { error = ex.Message },
                StatusCodes.Status500InternalServerError),
        };
    }
}
