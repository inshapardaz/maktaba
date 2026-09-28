using System.Text.RegularExpressions;
using SkiaSharp;

namespace Maktaba.Publishing;

/// <summary>
/// Issue #196 - a deliberately basic PDF publisher: paginates each chapter's merged text (page
/// markers stripped, light Markdown cleanup - see StripMarkdownAndMarkers) onto A4 pages via
/// SkiaSharp's SKDocument.CreatePdf, one paragraph per line-wrapped block. This is not a
/// typeset-quality renderer - no proper bidi/Arabic-script shaping (SkiaSharp draws glyphs as
/// given; a real RTL script needs a shaping engine like HarfBuzz, which isn't wired up here), no
/// embedded custom fonts, no image/heading styling. Right-aligning RTL-language text is the one
/// RTL accommodation made. Good enough for "get something readable out," not a replacement for a
/// real EPUB/print-quality pipeline - flagged clearly for follow-up polish.
/// </summary>
public partial class PdfPublisher : IBookPublisher
{
    public PublishFormat Format => PublishFormat.Pdf;
    public string FileExtension => "pdf";

    private const float PageWidth = 595; // A4 at 72dpi
    private const float PageHeight = 842;
    private const float Margin = 56;
    private const float BodySize = 12;
    private const float HeadingSize = 18;
    private const float LineHeight = BodySize * 1.5f;

    public byte[] Generate(PublishInput input)
    {
        var isRtl = input.Language is "ur" or "ar" or "fa";
        using var stream = new MemoryStream();

        using (var document = SKDocument.CreatePdf(stream))
        {
            var writer = new PageWriter(document, isRtl);
            writer.WriteHeading(input.Title, HeadingSize + 4);

            foreach (var chapter in input.Chapters)
            {
                writer.WriteHeading(chapter.Title, HeadingSize);
                foreach (var line in WrapToLines(StripMarkdownAndMarkers(chapter.MarkdownContent), writer.MaxCharsPerLine))
                {
                    writer.WriteBody(line);
                }
            }

            writer.Finish();
        }

        return stream.ToArray();
    }

    // Strips the Phase 7 hidden page-boundary marker (see PageBoundaryMarker in Maktaba.Core -
    // unlike EPUB's Markdig pipeline, which drops HTML comments automatically, or plain Markdown
    // output where the comment stays invisible in any renderer, a PDF renders whatever text it's
    // given literally) plus the lightest Markdown cleanup (heading/emphasis markers) so raw
    // "# "/"**"/"_" characters don't show up verbatim in the PDF.
    [GeneratedRegex(@"<!--\s*page:[^>]*-->")]
    private static partial Regex PageMarkerPattern();

    private static string StripMarkdownAndMarkers(string markdown)
    {
        var withoutMarkers = PageMarkerPattern().Replace(markdown, "");
        var withoutHeadings = Regex.Replace(withoutMarkers, @"^#+\s*", "", RegexOptions.Multiline);
        var withoutEmphasis = Regex.Replace(withoutHeadings, @"(\*\*|__|\*|_)", "");
        return withoutEmphasis;
    }

    private static IEnumerable<string> WrapToLines(string text, int maxCharsPerLine)
    {
        foreach (var paragraph in text.Split('\n'))
        {
            var trimmed = paragraph.Trim();
            if (trimmed.Length == 0)
            {
                yield return "";
                continue;
            }

            var words = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var current = "";
            foreach (var word in words)
            {
                var candidate = current.Length == 0 ? word : $"{current} {word}";
                if (candidate.Length > maxCharsPerLine && current.Length > 0)
                {
                    yield return current;
                    current = word;
                }
                else
                {
                    current = candidate;
                }
            }

            if (current.Length > 0)
            {
                yield return current;
            }
        }
    }

    private sealed class PageWriter(SKDocument document, bool isRtl)
    {
        private SKCanvas? canvas;
        private float y;

        public int MaxCharsPerLine => 90;

        private void NewPage()
        {
            canvas = document.BeginPage(PageWidth, PageHeight);
            y = Margin;
        }

        private void EnsureRoom(float needed)
        {
            if (canvas is null)
            {
                NewPage();
            }
            else if (y + needed > PageHeight - Margin)
            {
                document.EndPage();
                NewPage();
            }
        }

        public void WriteHeading(string text, float size)
        {
            EnsureRoom(size * 1.5f + LineHeight);
            y += size * 0.5f;
            DrawLine(text, size, true);
            y += LineHeight * 0.5f;
        }

        public void WriteBody(string line)
        {
            EnsureRoom(LineHeight);
            DrawLine(line, BodySize, false);
        }

        private void DrawLine(string text, float size, bool bold)
        {
            using var paint = new SKPaint { Color = SKColors.Black, IsAntialias = true };
            using var typeface = SKTypeface.FromFamilyName(null, bold ? SKFontStyle.Bold : SKFontStyle.Normal);
            using var font = new SKFont(typeface, size);

            var x = isRtl ? PageWidth - Margin : Margin;
            canvas!.DrawText(text, x, y, isRtl ? SKTextAlign.Right : SKTextAlign.Left, font, paint);
            y += size * 1.5f;
        }

        public void Finish()
        {
            if (canvas is not null)
            {
                document.EndPage();
            }

            document.Close();
        }
    }
}
