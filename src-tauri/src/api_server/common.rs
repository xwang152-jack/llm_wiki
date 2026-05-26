use std::collections::BTreeMap;

use serde_json::{json, Value};

#[derive(Debug)]
pub(super) struct ApiResponse {
    pub(super) status: u16,
    pub(super) body: Value,
}

pub(super) fn ok(body: Value) -> ApiResponse {
    ApiResponse { status: 200, body }
}

pub(super) fn err(status: u16, message: impl Into<String>) -> ApiResponse {
    ApiResponse {
        status,
        body: json!({ "ok": false, "error": message.into() }),
    }
}

pub(super) fn parse_query(query: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for pair in query.split('&').filter(|s| !s.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(percent_decode(key), percent_decode(value));
    }
    out
}

pub(super) fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_and_err_wrap_expected_payload_shape() {
        let ok_response = ok(json!({ "hello": "world" }));
        assert_eq!(ok_response.status, 200);
        assert_eq!(ok_response.body["hello"], "world");

        let err_response = err(418, "teapot");
        assert_eq!(err_response.status, 418);
        assert_eq!(err_response.body["ok"], false);
        assert_eq!(err_response.body["error"], "teapot");
    }

    #[test]
    fn parse_query_decodes_percent_plus_and_empty_values() {
        let parsed = parse_query("path=wiki%2Fhello+world.md&token=a%2Bb&empty=");
        assert_eq!(parsed.get("path").unwrap(), "wiki/hello world.md");
        assert_eq!(parsed.get("token").unwrap(), "a+b");
        assert_eq!(parsed.get("empty").unwrap(), "");
    }

    #[test]
    fn percent_decode_keeps_invalid_escape_sequences_literal() {
        assert_eq!(percent_decode("abc%ZZ+def"), "abc%ZZ def");
    }
}
