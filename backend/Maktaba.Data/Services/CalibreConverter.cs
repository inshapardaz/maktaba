using System.ComponentModel;
using System.Diagnostics;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

public class CalibreConverter : ICalibreConverter
{
    public bool IsAvailable { get; } = ProbeAvailability();

    private static bool ProbeAvailability()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "ebook-convert",
                ArgumentList = { "--version" },
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            });

            // No directory separator in the filename above, so .NET resolves it against PATH the same
            // way on every platform - that's what makes this check meaningful cross-platform rather than
            // Windows-specific shell behavior.
            process?.WaitForExit(5000);
            return process is { ExitCode: 0 };
        }
        catch (Win32Exception)
        {
            // ebook-convert isn't on PATH - the expected case when Calibre isn't installed.
            return false;
        }
    }

    public async Task ConvertAsync(string sourceFilePath, string destinationFilePath, CancellationToken ct = default)
    {
        if (!IsAvailable)
        {
            throw new InvalidOperationException("Calibre's ebook-convert is not available on PATH.");
        }

        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "ebook-convert",
            ArgumentList = { sourceFilePath, destinationFilePath },
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("Failed to start ebook-convert.");

        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        if (process.ExitCode != 0)
        {
            var stderr = await stderrTask;
            throw new InvalidOperationException($"ebook-convert failed (exit code {process.ExitCode}): {stderr}");
        }
    }
}
