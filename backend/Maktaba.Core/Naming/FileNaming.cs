namespace Maktaba.Core.Naming;

public static class FileNaming
{
    /// <summary>Replaces characters invalid in file/folder names with "_" and trims trailing dots/spaces.</summary>
    public static string SanitizePathSegment(string value)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        var chars = value.Select(c => invalidChars.Contains(c) ? '_' : c).ToArray();
        var sanitized = new string(chars).Trim().TrimEnd('.', ' ');
        return sanitized.Length == 0 ? "_" : sanitized;
    }
}
