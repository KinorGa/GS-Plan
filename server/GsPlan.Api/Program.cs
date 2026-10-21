using System.Text.Encodings.Web;
using GsPlan.Api.Endpoints;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Options;
using GsPlan.Api.Services;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

var options = builder.Configuration.GetSection("GsPlan").Get<GsPlanOptions>() ?? new GsPlanOptions();
var contentRoot = builder.Environment.ContentRootPath;

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Limits.MaxRequestBodySize = options.MaxBodyBytes;
});
builder.WebHost.UseUrls($"http://127.0.0.1:{options.Port}");

builder.Services.Configure<GsPlanOptions>(builder.Configuration.GetSection("GsPlan"));
builder.Services.Configure<Microsoft.AspNetCore.Http.Json.JsonOptions>(json =>
{
    json.SerializerOptions.Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});
builder.Services.AddSingleton(_ => AppPaths.Resolve(options, contentRoot));
builder.Services.AddSingleton<DataStore>();
builder.Services.AddSingleton<OptimizerRunner>();
builder.Services.AddSingleton<StatsCatalog>();
builder.Services.AddSingleton<CoreDataCatalog>();
builder.Services.AddHttpClient("vision", (services, client) =>
{
    var current = services.GetRequiredService<IOptions<GsPlanOptions>>().Value;
    client.Timeout = TimeSpan.FromSeconds(Math.Max(1, current.VisionTimeoutSeconds));
});
builder.Services.AddSingleton<VisionRelay>();

var app = builder.Build();
var paths = app.Services.GetRequiredService<ResolvedPaths>();

app.Logger.LogInformation("Repo root: {RepoRoot}", paths.RepoRoot);
app.Logger.LogInformation("Serving dist: {DistRoot}", paths.DistRoot);
app.Logger.LogInformation("Data file: {DataFile}", paths.DataFile);
app.Logger.LogInformation("Stats file: {StatsFile}", paths.StatsFile);
app.Logger.LogInformation("Optimizer: {OptimizerPath}", paths.OptimizerPath);

if (Directory.Exists(paths.DistRoot))
{
    var provider = new PhysicalFileProvider(paths.DistRoot);
    var contentTypes = new FileExtensionContentTypeProvider();
    contentTypes.Mappings[".webp"] = "image/webp";
    contentTypes.Mappings[".woff2"] = "font/woff2";

    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = provider });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = provider,
        ContentTypeProvider = contentTypes,
        OnPrepareResponse = context =>
        {
            context.Context.Response.Headers.CacheControl = "no-cache";
            var contentType = context.Context.Response.ContentType;
            if (contentType == "text/html") context.Context.Response.ContentType = "text/html; charset=utf-8";
            else if (contentType == "text/javascript") context.Context.Response.ContentType = "text/javascript; charset=utf-8";
            else if (contentType == "text/css") context.Context.Response.ContentType = "text/css; charset=utf-8";
            else if (contentType == "application/json") context.Context.Response.ContentType = "application/json; charset=utf-8";
        },
    });
}
else
{
    app.Logger.LogWarning("dist/ not found - run `npm run build` first");
}

app.MapGet("/api/health", () => Results.Json(new { ok = true, service = "gs-plan" }));
app.MapDataEndpoints();
app.MapOptimizeEndpoints();
app.MapVisionEndpoints();
app.MapCoreEndpoints();
app.MapConfigEndpoints();
app.MapGcsimEndpoints();
app.MapArtifactScanEndpoints();

// Method mismatches must be 405, not the SPA fallback's 404. These routes have
// no method constraint, so they only win after the method-specific endpoints
// above have declined the request.
app.Map("/api/data", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/optimize", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/optimize/artifact", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/optimize/artifact/problem", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/optimize/artifact/parse", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/optimize/artifact/plan", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/vision", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/damage", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/damage-batch", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/derive-panel", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/derive-panel-batch", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/axis", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/merged-expression", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/merged-evaluate", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/substat-rolls", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/meta", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/config/export", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/config/import", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/gcsim/import", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/artifact/scan", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/formula", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
app.Map("/api/core/artifact-summary", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));

app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsync("{\"error\":\"not found\"}");
        return;
    }

    var index = Path.Combine(paths.DistRoot, "index.html");
    if (!File.Exists(index))
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.ContentType = "text/plain; charset=utf-8";
        await context.Response.WriteAsync("dist/ not found - run `npm run build` first");
        return;
    }

    context.Response.Headers.CacheControl = "no-cache";
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(index);
});

app.Run();
