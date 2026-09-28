using System.IO.Compression;
using System.Text;
using Markdig;

namespace Maktaba.Publishing;

/// <summary>
/// Ported from the user's own MarkdownToEpubConverter
/// (https://github.com/inshapardaz/api/blob/master/src/Inshapardaz.Domain/Adapters/MarkdownToEpubConverter.cs,
/// read directly from the local inshapardaz/api checkout at C:\code\inshapardaz\api per the epic's
/// own handoff note), adapted from Nawishta's BookModel/Category to this project's plain
/// PublishInput and from a coverImage byte[] parameter to PublishInput.CoverImageBytes. Structure,
/// XML/XHTML templates, and manifest/spine/nav/toc.ncx generation are otherwise unchanged -
/// deliberately not "improved" or restructured, since matching the original's actual output is the
/// point of a port.
///
/// One deviation the epic's amendments explicitly call for: the original writes a single
/// &lt;dc:publisher&gt; from one string; this emits *two* (EPUB/OPF allows multiple) - one literally
/// "Maktaba", one with PublishInput.Publisher (omitted if null/empty) - never dropping the original.
/// </summary>
public class EpubPublisher : IBookPublisher
{
    public PublishFormat Format => PublishFormat.Epub;
    public string FileExtension => "epub";

    public byte[] Generate(PublishInput input)
    {
        var direction = input.Language == "ur" ? "rtl" : "ltr";
        var epubFolder = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
        var oebpsDir = Path.Combine(epubFolder, "OEBPS");
        var metaInfDir = Path.Combine(epubFolder, "META-INF");
        Directory.CreateDirectory(epubFolder);
        Directory.CreateDirectory(oebpsDir);
        Directory.CreateDirectory(metaInfDir);

        var manifest = new StringBuilder();
        var spine = new StringBuilder();
        var navItems = new StringBuilder();

        WriteMimeType(epubFolder);
        WriteContainerXml(metaInfDir);
        WriteCss(direction, oebpsDir, manifest);

        var coverItem = WriteCoverImage(input.CoverImageBytes, oebpsDir, manifest, spine);

        WriteChapters(input.Chapters, input.Language, direction, oebpsDir, manifest, spine, navItems);
        WriteNavigation(input.Chapters, oebpsDir, manifest, spine);
        WriteLegacyNavigation(input, oebpsDir, manifest);
        WriteContentOpf(input, coverItem, manifest, direction, spine, oebpsDir);

        var outputPath = Path.Combine(Path.GetTempPath(), $"{Path.GetRandomFileName()}.epub");
        var epubBytes = CreateEPubFile(outputPath, epubFolder);

        Directory.Delete(epubFolder, true);
        File.Delete(outputPath);

        return epubBytes;
    }

    private static void WriteMimeType(string epubFolder) =>
        File.WriteAllText(Path.Combine(epubFolder, "mimetype"), "application/epub+zip", new UTF8Encoding(false));

    private static void WriteContainerXml(string metaInfDir)
    {
        File.WriteAllText(Path.Combine(metaInfDir, "container.xml"),
            @"<?xml version='1.0' encoding='utf-8'?>
          <container version='1.0' xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
            <rootfiles>
              <rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/>
            </rootfiles>
          </container>");
    }

    private static void WriteCss(string direction, string oebpsDir, StringBuilder manifest)
    {
        var rtlBullets = direction == "rtl"
            ? @"ul, ol {
              direction: ltr;
              unicode-bidi: embed;
              text-align: left;
              margin-left: 1.5em;
            }
            ul li, ol li {
              direction: rtl;
              text-align: right;
            }"
            : "";

        File.WriteAllText(Path.Combine(oebpsDir, "styles.css"), $@"
body {{
  direction: {direction};
  unicode-bidi: embed;
  font-family: serif;
  line-height: 1.6;
  text-align: right;
}}
{rtlBullets}
");

        manifest.AppendLine("    <item id='css' href='styles.css' media-type='text/css'/>");
    }

    private static string WriteCoverImage(byte[]? coverImage, string oebpsDir, StringBuilder manifest, StringBuilder spine)
    {
        var coverItem = "";
        if (coverImage != null)
        {
            var mimeType = GetImageMimeType(coverImage);
            var fileName = $"cover.{GetFileExtensionFromMimeType(mimeType)}";
            File.WriteAllBytes(Path.Combine(oebpsDir, fileName), coverImage);
            manifest.AppendLine($"    <item id='cover' href='{fileName}' media-type='{mimeType}' properties='cover-image'/>");
            coverItem = "<meta name='cover' content='cover'/>";

            var titlePageContent = $@"<?xml version='1.0' encoding='utf-8'?>
          <html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops' lang='ur' xml:lang='ur' dir='rtl'>
            <head>
              <title>Cover</title>
              <style type='text/css' title='override_css'>
                      @page {{padding: 0pt; margin:0pt}}
                      body {{ text-align: center; padding:0pt; margin: 0pt; }}
                  </style>
              <meta http-equiv='Content-Type' content='text/html; charset=utf-8'/>
            </head>
            <body>
                  <div>
                      <svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' version='1.1' width='100%' height='100%' viewBox='0 0 1118 1588' preserveAspectRatio='none'>
                          <image width='1118' height='1588' xlink:href='{fileName}'/>
                      </svg>
                  </div>
              </body>
          </html>";
            File.WriteAllText(Path.Combine(oebpsDir, "titlepage.xhtml"), titlePageContent, Encoding.UTF8);

            manifest.AppendLine("    <item id='titlepage' href='titlepage.xhtml' media-type='application/xhtml+xml'/>");
            spine.AppendLine("    <itemref idref=\"titlepage\" />\n");
        }

        return coverItem;
    }

    private static void WriteChapters(
        IReadOnlyList<PublishChapter> chapters, string? language, string direction, string oebpsDir,
        StringBuilder manifest, StringBuilder spine, StringBuilder navItems)
    {
        var pipeline = new MarkdownPipelineBuilder().UseAdvancedExtensions().Build();
        for (var i = 0; i < chapters.Count; i++)
        {
            var chapter = chapters[i];
            var html = Markdown.ToHtml(chapter.MarkdownContent, pipeline);

            var xhtml = $@"<?xml version='1.0' encoding='utf-8'?>
            <!DOCTYPE html>
            <html xmlns='http://www.w3.org/1999/xhtml' xml:lang='{language}' dir='{direction}'>
              <head>
                <title>{chapter.Title}</title>
                <link rel='stylesheet' type='text/css' href='styles.css'/>
              </head>
              <body>
                {html}
              </body>
            </html>";

            var fileName = $"chapter{i + 1}.xhtml";
            File.WriteAllText(Path.Combine(oebpsDir, fileName), xhtml, Encoding.UTF8);

            manifest.AppendLine($"    <item id='chap{i + 1}' href='{fileName}' media-type='application/xhtml+xml'/>");
            spine.AppendLine($"    <itemref idref='chap{i + 1}'/>");
            navItems.AppendLine($"      <li><a href='{fileName}'>{chapter.Title}</a></li>");
        }
    }

    private static void WriteNavigation(IReadOnlyList<PublishChapter> chapters, string oebpsDir, StringBuilder manifest, StringBuilder spine)
    {
        var toc = new StringBuilder();
        toc.AppendLine(@"<?xml version=""1.0"" encoding=""utf-8""?>
          <!DOCTYPE html>
          <html xmlns=""http://www.w3.org/1999/xhtml""
                xmlns:epub=""http://www.idpf.org/2007/ops""
                xml:lang=""ur"" dir=""rtl"">
          <head><title>TOC</title></head>
          <body>
          <nav epub:type=""toc"" id=""toc"">
          <h1>فہرست مضامین</h1>
          <ol>");

        for (var i = 0; i < chapters.Count; i++)
        {
            toc.AppendLine($"<li><a href=\"chapter{i + 1}.xhtml\">{chapters[i].Title}</a></li>");
        }

        toc.AppendLine("</ol></nav></body></html>");
        File.WriteAllText(Path.Combine(oebpsDir, "nav.xhtml"), toc.ToString(), Encoding.UTF8);

        manifest.AppendLine("    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav' />");
        spine.AppendLine("    <itemref idref=\"nav\" />\n");
    }

    private static void WriteLegacyNavigation(PublishInput input, string oebpsDir, StringBuilder manifest)
    {
        var toc = new StringBuilder();
        toc.AppendLine($@"<ncx xmlns=""http://www.daisy.org/z3986/2005/ncx/"" version=""2005-1"" xml:lang=""{input.Language}"" >
             <head>
              <meta content=""{Guid.NewGuid()}"" name=""dtb:uid""/>
              <meta content=""2"" name=""dtb:depth""/>
              <meta content=""Maktaba"" name=""dtb:generator""/>
            </head>
            <docTitle>
              <text>{input.Title}</text>
            </docTitle>
            <navMap>");

        for (var i = 0; i < input.Chapters.Count; i++)
        {
            toc.AppendLine($@"<navPoint id=""{GenerateEpubUniqueId()}"" playOrder=""{i + 1}"">
                <navLabel>
                  <text>{input.Chapters[i].Title}</text>
                </navLabel>
                <content src=""chapter{i + 1}.xhtml""/>
            </navPoint>");
        }

        toc.AppendLine("</navMap>\n</ncx>");
        File.WriteAllText(Path.Combine(oebpsDir, "toc.ncx"), toc.ToString(), Encoding.UTF8);

        manifest.AppendLine("    <item href=\"toc.ncx\" id=\"ncx\" media-type=\"application/x-dtbncx+xml\"/>");
    }

    private static void WriteContentOpf(
        PublishInput input, string coverItem, StringBuilder manifest, string direction, StringBuilder spine, string oebpsDir)
    {
        var authorsXml = string.Join("\n", input.Authors.Select(a => $"<dc:creator>{a}</dc:creator>"));

        // Epic amendment: two <dc:publisher> elements (EPUB/OPF allows multiple), never dropping
        // the book's own original publisher - unlike the source converter's single-string field.
        var publisherXml = "<dc:publisher>Maktaba</dc:publisher>" +
            (!string.IsNullOrEmpty(input.Publisher) ? $"\n    <dc:publisher>{input.Publisher}</dc:publisher>" : "");

        var seriesMeta = !string.IsNullOrEmpty(input.SeriesName)
            ? $"<meta property='belongs-to-collection'>{input.SeriesName}</meta>"
            : "";
        var seriesIndexMeta = input.SeriesIndex.HasValue
            ? $"<meta property='group-position'>{input.SeriesIndex.Value}</meta>"
            : "";
        const string generatorMeta = "<meta name='generator' content='Maktaba'/>";

        var uniqueIdentifier = GenerateEpubUniqueId();
        var opfContent = $@"<?xml version='1.0' encoding='utf-8'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf' unique-identifier='{uniqueIdentifier}' xml:lang='{input.Language}'>
  <metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>
    <dc:identifier id='bookid'>urn:uuid:{Guid.NewGuid()}</dc:identifier>
    <dc:identifier xmlns:opf=""http://www.idpf.org/2007/opf"" id=""{uniqueIdentifier}"" opf:scheme=""uuid"">{uniqueIdentifier}</dc:identifier>
    <dc:title>{input.Title}</dc:title>
    <dc:language>{input.Language}</dc:language>
    {authorsXml}
    {publisherXml}
    {seriesMeta}
    {seriesIndexMeta}
    {generatorMeta}
    {coverItem}
  </metadata>
  <manifest>
{manifest.ToString().TrimEnd()}
  </manifest>
  <spine toc=""ncx"" page-progression-direction='{direction}'>
{spine.ToString().TrimEnd()}
  </spine>
</package>";

        File.WriteAllText(Path.Combine(oebpsDir, "content.opf"), opfContent, Encoding.UTF8);
    }

    private static byte[] CreateEPubFile(string outputFilePath, string epubFolder)
    {
        if (File.Exists(outputFilePath))
        {
            File.Delete(outputFilePath);
        }

        ZipFile.CreateFromDirectory(epubFolder, outputFilePath, CompressionLevel.Optimal, false);
        return File.ReadAllBytes(outputFilePath);
    }

    private static string GenerateEpubUniqueId(int length = 22)
    {
        const string letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        const string alphanum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var random = new Random();
        var sb = new StringBuilder(length);
        sb.Append(letters[random.Next(letters.Length)]);
        for (var i = 1; i < length; i++)
        {
            sb.Append(alphanum[random.Next(alphanum.Length)]);
        }

        return sb.ToString();
    }

    private static string GetImageMimeType(byte[] imageData)
    {
        if (imageData.Length >= 3 && imageData[0] == 0xFF && imageData[1] == 0xD8 && imageData[2] == 0xFF)
        {
            return "image/jpeg";
        }

        if (imageData.Length >= 8 && imageData[0] == 0x89 && imageData[1] == 0x50 && imageData[2] == 0x4E && imageData[3] == 0x47)
        {
            return "image/png";
        }

        return "image/jpeg";
    }

    private static string GetFileExtensionFromMimeType(string mimeType) => mimeType switch
    {
        "image/png" => "png",
        _ => "jpg",
    };
}
