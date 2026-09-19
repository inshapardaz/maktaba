namespace Maktaba.Nawishta.Generated;

// Issue #144 - a genuine gap in Nawishta's live swagger spec, not a request/response-shape
// mismatch this hand-written client otherwise works around: BookContentView really does carry a
// "checksum" field server-side (a lowercase SHA-256 hex string, confirmed against the api repo's
// own BookContentModel/BookMapper/ChecksumHelper - computed and populated on every file upload,
// not a dormant column), it just isn't declared in the OpenAPI document NSwag generated this
// partial class from, so it's added here as a second partial declaration instead of hand-rolling
// a whole separate DTO. Applies equally to a content nested inside BookView.Contents
// (NawishtaEntityMapper.ToBook) and NawishtaRawApiClient.UploadContentAsync's own direct response,
// since both deserialize into this exact same type.
public partial class BookContentView
{
    [System.Text.Json.Serialization.JsonPropertyName("checksum")]
    public string? Checksum { get; set; }
}
