using Sqids;

namespace Maktaba.Core.Ids;

/// <summary>
/// Converts between the database's internal auto-increment integer ids and the short, opaque
/// (sqids.org) strings used everywhere outside the database: API request/response bodies and the
/// id embedded in on-disk book folder names ("{Title} ({Sqid})"), which is what lets a library
/// rescan preserve a book's identity.
///
/// One shared encoder/alphabet is used for every entity type (Book, Author, Series, Tag) - a Book
/// and an Author with the same integer id would therefore encode to the same string. That's fine
/// here: each id is only ever decoded in the context of the specific table it's looked up against
/// (e.g. an authorId is only ever used to query Authors), so cross-entity collisions can't cause
/// incorrect results, just a lookup miss if the wrong kind of id is passed somewhere.
/// </summary>
public static class IdCodec
{
    private static readonly SqidsEncoder<int> Encoder = new(new SqidsOptions { MinLength = 8 });

    public static string Encode(int id) => Encoder.Encode(id);

    /// <summary>Decodes a sqid back to its integer id. False if <paramref name="sqid"/> isn't a valid sqid.</summary>
    public static bool TryDecode(string sqid, out int id)
    {
        var decoded = Encoder.Decode(sqid);
        if (decoded.Count != 1)
        {
            id = 0;
            return false;
        }

        id = decoded[0];
        return true;
    }
}
