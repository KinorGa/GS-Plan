using GsPlan.Api.Options;

namespace GsPlan.Api.Infrastructure;

public sealed class ResolvedPaths
{
    public required string RepoRoot { get; init; }
    public required string DistRoot { get; init; }
    public required string DataFile { get; init; }
    public required string OptimizerPath { get; init; }
}

public static class AppPaths
{
    public static ResolvedPaths Resolve(GsPlanOptions options, string contentRoot)
    {
        var repoRoot = FindRepoRoot(options.RepoRoot, contentRoot);

        return new ResolvedPaths
        {
            RepoRoot = repoRoot,
            DistRoot = ResolveConfigured(options.DistRoot, repoRoot, "dist"),
            DataFile = ResolveConfigured(
                options.DataFile,
                repoRoot,
                Path.Combine("data", "config", "buff-library.json")),
            OptimizerPath = ResolveConfigured(
                options.OptimizerPath,
                repoRoot,
                Path.Combine("native", "optimize", "optimize.exe")),
        };
    }

    private static string ResolveConfigured(string? value, string root, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return Path.Combine(root, fallback);
        return Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(root, value));
    }

    private static string FindRepoRoot(string? explicitRoot, string contentRoot)
    {
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(explicitRoot))
        {
            AddCandidate(candidates, explicitRoot);
        }

        AddCandidate(candidates, contentRoot);
        AddCandidate(candidates, Path.Combine(contentRoot, "..", ".."));
        AddCandidate(candidates, Directory.GetCurrentDirectory());
        AddCandidate(candidates, AppContext.BaseDirectory);

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            AddCandidate(candidates, dir.FullName);
        }

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (Directory.Exists(Path.Combine(candidate, "dist"))
                || File.Exists(Path.Combine(candidate, "native", "optimize", "optimize.exe"))
                || Directory.Exists(Path.Combine(candidate, "data")))
            {
                return candidate;
            }
        }

        return Path.GetFullPath(contentRoot);
    }

    private static void AddCandidate(List<string> candidates, string path)
    {
        try
        {
            candidates.Add(Path.GetFullPath(path));
        }
        catch
        {
            // A malformed configured path should not take startup down.
        }
    }
}
