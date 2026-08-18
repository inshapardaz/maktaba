//! System.Text.Json (the C# backend's JSON serializer) renders a `DateTime` with `Kind = Utc`
//! (which every timestamp in this app is) with a trailing "Z", and the frontend's `new Date(...)`
//! calls rely on that to avoid misinterpreting the string as local time. chrono's `NaiveDateTime`
//! carries no timezone, so this module formats/parses that same "...Z" convention explicitly to
//! keep the wire format identical to the old backend's.

use chrono::NaiveDateTime;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub fn serialize<S: Serializer>(dt: &NaiveDateTime, s: S) -> Result<S::Ok, S::Error> {
    format!("{}Z", dt.format("%Y-%m-%dT%H:%M:%S%.f")).serialize(s)
}

pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<NaiveDateTime, D::Error> {
    let raw = String::deserialize(d)?;
    parse(&raw).map_err(serde::de::Error::custom)
}

pub fn parse(raw: &str) -> Result<NaiveDateTime, String> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Ok(dt.naive_utc());
    }
    let trimmed = raw.trim_end_matches('Z');
    NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S"))
        .map_err(|e| format!("invalid datetime {raw:?}: {e}"))
}

pub mod opt {
    use super::*;

    pub fn serialize<S: Serializer>(dt: &Option<NaiveDateTime>, s: S) -> Result<S::Ok, S::Error> {
        match dt {
            Some(dt) => super::serialize(dt, s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<NaiveDateTime>, D::Error> {
        let raw: Option<String> = Option::deserialize(d)?;
        match raw {
            Some(raw) => parse(&raw).map(Some).map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}
