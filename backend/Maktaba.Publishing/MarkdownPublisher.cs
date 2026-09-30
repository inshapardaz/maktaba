using System.Text;

namespace Maktaba.Publishing;

/// <summary>Issue #195 - the plain-Markdown publish format: each chapter as a level-1 heading
/// followed by its already-merged content (hidden page markers and all - they're HTML comments,
/// invisible in any Markdown renderer, so leaving them in keeps this output byte-identical to what
/// EpubPublisher renders from, useful for diffing/debugging a publish).</summary>
public class MarkdownPublisher : IBookPublisher
{
    public PublishFormat Format => PublishFormat.Markdown;
    public string FileExtension => "md";

    public byte[] Generate(PublishInput input)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# {input.Title}");
        sb.AppendLine();

        foreach (var chapter in input.Chapters)
        {
            sb.AppendLine($"## {chapter.Title}");
            sb.AppendLine();
            sb.AppendLine(chapter.MarkdownContent);
            sb.AppendLine();
        }

        return Encoding.UTF8.GetBytes(sb.ToString());
    }
}
