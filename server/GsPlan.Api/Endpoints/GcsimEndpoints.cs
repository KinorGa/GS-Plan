using System.IO.Compression;
using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Services;
using GsPlan.Core.Gcsim;

namespace GsPlan.Api.Endpoints;

/// <summary>
/// The gcsim sample boundary. The request body is the file the user picked --
/// zlib, gzip or plain JSON -- so it is read as bytes rather than JSON. The
/// importer is the C# port of <c>src/lib/gcsim-import.js</c>; the browser still
/// falls back to the JS one when this service is absent.
/// </summary>
public static class GcsimEndpoints
{
    public static IEndpointRouteBuilder MapGcsimEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/gcsim/import", async (HttpContext context, CoreDataCatalog catalog) =>
        {
            byte[] body;
            try
            {
                body = await RequestBody.ReadBytesAsync(context.Request, context.RequestAborted);
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

            JsonElement sample;
            try
            {
                sample = ParseSample(body);
            }
            catch (Exception ex)
            {
                return ApiResults.Json(
                    context,
                    new { error = "sample is not zlib/gzip/JSON: " + ex.Message },
                    StatusCodes.Status400BadRequest);
            }

            var mapping = catalog.GcsimMapping;
            var characters = catalog.CharacterCatalogue;
            var weapons = catalog.WeaponCatalogue;
            var artifacts = catalog.ArtifactCatalogue;
            if (mapping is null || characters is null || weapons is null || artifacts is null)
            {
                return ApiResults.Json(
                    context,
                    new { error = "gcsim data files are not available on the service" },
                    StatusCodes.Status500InternalServerError);
            }

            var lang = context.Request.Query["lang"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(lang)) lang = "chs";

            try
            {
                // Character details stay Chinese whatever the page language is:
                // the mapping table names stages by their Chinese row name.
                var charData = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
                foreach (var id in GcsimImporter.ResolveCharacterIds(sample, mapping.Value, characters.Value))
                {
                    var detail = catalog.GetCharacterDetail("chs", id);
                    if (detail is not null) charData[id] = detail.Value;
                }

                var setBonuses = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
                foreach (var id in GcsimImporter.ResolveSetIds(sample, mapping.Value, artifacts.Value))
                {
                    var detail = catalog.GetArtifactDetail(lang, id);
                    if (detail is null) continue;
                    var value = detail.Value;
                    if (value.ValueKind != JsonValueKind.Object
                        || !value.TryGetProperty("info", out var info)
                        || info.ValueKind != JsonValueKind.Object
                        || !info.TryGetProperty("setBonuses", out var bonuses)
                        || bonuses.ValueKind == JsonValueKind.Null)
                    {
                        continue;
                    }
                    setBonuses[id] = bonuses.Clone();
                }

                var result = GcsimImporter.Import(new GcsimImportInput
                {
                    Sample = sample,
                    Mapping = mapping.Value,
                    Catalogues = new GcsimCatalogues
                    {
                        Characters = characters.Value,
                        Weapons = weapons.Value,
                        Artifacts = artifacts.Value,
                    },
                    CharacterData = charData,
                    TalentDamage = catalog.TalentDamage,
                    SetBonuses = setBonuses,
                    Stats = catalog.Stats,
                });
                return ApiResults.Json(context, new { doc = result.Doc, report = result.Report });
            }
            catch (GcsimImportException ex)
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

    private static JsonElement ParseSample(byte[] bytes)
    {
        if (bytes.Length >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b)
        {
            using var gzip = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress);
            using var document = JsonDocument.Parse(gzip);
            return document.RootElement.Clone();
        }
        if (bytes.Length >= 1 && bytes[0] == 0x78)
        {
            using var zlib = new ZLibStream(new MemoryStream(bytes), CompressionMode.Decompress);
            using var document = JsonDocument.Parse(zlib);
            return document.RootElement.Clone();
        }
        using var plain = JsonDocument.Parse(bytes);
        return plain.RootElement.Clone();
    }
}
