using System.Text;
using GsPlan.Api.Infrastructure;

namespace GsPlan.Api.Services;

public sealed class DataStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public DataStore(ResolvedPaths paths)
    {
        _path = paths.DataFile;
    }

    public async Task<string?> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return null;
        return await File.ReadAllTextAsync(_path, Encoding.UTF8, cancellationToken);
    }

    public async Task WriteAsync(string text, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        var directory = Path.GetDirectoryName(_path);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";

        try
        {
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(temp, text, new UTF8Encoding(false), cancellationToken);
            File.Move(temp, _path, overwrite: true);
        }
        finally
        {
            _gate.Release();
            if (File.Exists(temp))
            {
                try { File.Delete(temp); } catch { /* best effort */ }
            }
        }
    }
}
