namespace GsPlan.Api.Options;

public sealed class GsPlanOptions
{
    public int Port { get; set; } = 5199;

    /// <summary>Override when the repository is not two levels above the API project.</summary>
    public string? RepoRoot { get; set; }

    public string? DistRoot { get; set; }
    public string? DataFile { get; set; }
    public string? StatsFile { get; set; }
    public string? OptimizerPath { get; set; }

    public long MaxBodyBytes { get; set; } = 32L * 1024 * 1024;
    public int OptimizerTimeoutSeconds { get; set; } = 180;
    public int VisionTimeoutSeconds { get; set; } = 180;
}
