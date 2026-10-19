using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using GsPlan.Api.Infrastructure;
using GsPlan.Api.Options;
using Microsoft.Extensions.Options;

namespace GsPlan.Api.Services;

public sealed class OptimizerRunner
{
    private readonly string _path;
    private readonly GsPlanOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public OptimizerRunner(ResolvedPaths paths, IOptions<GsPlanOptions> options)
    {
        _path = paths.OptimizerPath;
        _options = options.Value;
    }

    public async Task<OptimizerRunResult> RunAsync(string problem, CancellationToken cancellationToken)
    {
        if (!File.Exists(_path))
        {
            throw new OptimizerUnavailableException(
                "优化器还没编译：先运行 native/optimize/build.bat（或 g++ -O2 -std=c++17 -o optimize.exe main.cpp），然后重试");
        }

        await _gate.WaitAsync(cancellationToken);
        var directory = Path.Combine(Path.GetTempPath(), "gsplan-opt-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(directory);
            var file = Path.Combine(directory, "problem.txt");
            await File.WriteAllTextAsync(file, problem, new UTF8Encoding(false), cancellationToken);

            var startInfo = new ProcessStartInfo
            {
                FileName = _path,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.ArgumentList.Add(file);

            using var process = new Process { StartInfo = startInfo };
            var started = Stopwatch.StartNew();

            try
            {
                if (!process.Start())
                {
                    throw new OptimizerStartException($"cannot run {_path}");
                }
            }
            catch (Win32Exception ex)
            {
                throw new OptimizerStartException($"cannot run {_path}: {ex.Message}");
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, _options.OptimizerTimeoutSeconds)));

            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                TryKill(process);
                throw new OptimizerTimeoutException(
                    $"优化器超过 {Math.Max(1, _options.OptimizerTimeoutSeconds)} 秒未结束，已终止");
            }
            catch (OperationCanceledException)
            {
                TryKill(process);
                throw;
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            started.Stop();

            if (process.ExitCode != 0)
            {
                throw new OptimizerFailedException(process.ExitCode, stderr);
            }

            return new OptimizerRunResult(stdout, started.Elapsed.TotalMilliseconds);
        }
        finally
        {
            _gate.Release();
            try { Directory.Delete(directory, recursive: true); } catch { /* best effort */ }
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // The process may have exited between the check and the kill.
        }
    }
}

public sealed record OptimizerRunResult(string Csv, double ElapsedMs);

public sealed class OptimizerUnavailableException : Exception
{
    public OptimizerUnavailableException(string message) : base(message) { }
}

public sealed class OptimizerStartException : Exception
{
    public OptimizerStartException(string message) : base(message) { }
}

public sealed class OptimizerTimeoutException : Exception
{
    public OptimizerTimeoutException(string message) : base(message) { }
}

public sealed class OptimizerFailedException : Exception
{
    public OptimizerFailedException(int exitCode, string standardError) : base($"optimizer exited with {exitCode}")
    {
        ExitCode = exitCode;
        StandardError = standardError;
    }

    public int ExitCode { get; }
    public string StandardError { get; }
}
