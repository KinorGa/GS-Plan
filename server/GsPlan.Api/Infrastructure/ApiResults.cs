using System.Text.Encodings.Web;
using System.Text.Json;

namespace GsPlan.Api.Infrastructure;

public static class ApiResults
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static IResult Json(HttpContext context, object value, int statusCode = StatusCodes.Status200OK)
    {
        context.Response.Headers.CacheControl = "no-store";
        return Results.Text(
            JsonSerializer.Serialize(value, Options),
            "application/json; charset=utf-8",
            statusCode: statusCode);
    }
}
