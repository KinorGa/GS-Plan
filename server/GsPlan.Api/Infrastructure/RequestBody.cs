using System.Text;

namespace GsPlan.Api.Infrastructure;

public static class RequestBody
{
    public static async Task<string> ReadTextAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(
            request.Body,
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 8192,
            leaveOpen: true);
        return await reader.ReadToEndAsync(cancellationToken);
    }
}
