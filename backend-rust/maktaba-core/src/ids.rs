//! Converts between the database's internal auto-increment integer ids and the short, opaque
//! (sqids.org) strings used everywhere outside the database: API request/response bodies and the
//! id embedded in on-disk book folder names ("{Title} ({Sqid})"), which is what lets a library
//! rescan preserve a book's identity.
//!
//! One shared encoder/alphabet is used for every entity type (Book, Author, Series, Tag) - a Book
//! and an Author with the same integer id would therefore encode to the same string. That's fine
//! here: each id is only ever decoded in the context of the specific table it's looked up against
//! (e.g. an authorId is only ever used to query Authors), so cross-entity collisions can't cause
//! incorrect results, just a lookup miss if the wrong kind of id is passed somewhere.
//!
//! Mirrors Maktaba.Core/Ids/IdCodec.cs. The C# side used SqidsEncoder<int>; ids here are stored
//! as i64 (SQLite's native INTEGER affinity) but are always non-negative auto-increment values,
//! so the u64 round-trip through the sqids crate is lossless.

use sqids::Sqids;
use std::sync::LazyLock;

static ENCODER: LazyLock<Sqids> = LazyLock::new(|| {
    Sqids::builder()
        .min_length(8)
        .build()
        .expect("static sqids config is always valid")
});

pub fn encode(id: i64) -> String {
    ENCODER
        .encode(&[id as u64])
        .expect("a single non-negative id always encodes")
}

/// Decodes a sqid back to its integer id. `None` if `sqid` isn't a valid sqid.
pub fn try_decode(sqid: &str) -> Option<i64> {
    let decoded = ENCODER.decode(sqid);
    if decoded.len() != 1 {
        return None;
    }
    Some(decoded[0] as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for id in [0i64, 1, 42, 123456] {
            let sqid = encode(id);
            assert_eq!(try_decode(&sqid), Some(id));
        }
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(try_decode("not-a-valid-sqid!!"), None);
        assert_eq!(try_decode(""), None);
    }

    #[test]
    fn min_length_is_eight() {
        assert!(encode(1).len() >= 8);
    }
}
