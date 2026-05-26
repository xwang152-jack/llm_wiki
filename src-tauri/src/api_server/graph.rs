use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use walkdir::WalkDir;

use crate::commands;

use super::common::{err, ok, parse_query, ApiResponse};
use super::projects::resolve_project;
use super::relative_to_project;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiGraphNode {
    id: String,
    label: String,
    node_type: String,
    path: String,
    link_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiGraphEdge {
    source: String,
    target: String,
    weight: f64,
}

#[derive(Debug, Clone)]
struct ParsedGraphDocument {
    id: String,
    title: String,
    node_type: String,
    sources: Vec<String>,
    links: Vec<String>,
}

pub(super) fn handle_graph(app: &AppHandle, project_id: &str, query: &str) -> ApiResponse {
    let project = match resolve_project(app, project_id) {
        Ok(project) => project,
        Err(error) => return err(404, error),
    };
    let params = parse_query(query);
    let q = params.get("q").map(|value| value.to_lowercase());
    let node_type = params.get("nodeType").map(|value| value.to_lowercase());
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(200)
        .clamp(1, 1000);

    match build_graph(&project.path) {
        Ok((mut nodes, edges)) => {
            if let Some(ref q) = q {
                nodes.retain(|node| {
                    node.id.to_lowercase().contains(q) || node.label.to_lowercase().contains(q)
                });
            }
            if let Some(ref node_type) = node_type {
                nodes.retain(|node| node.node_type == *node_type);
            }
            nodes.truncate(limit);
            let ids: BTreeSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
            let edges: Vec<ApiGraphEdge> = edges
                .into_iter()
                .filter(|edge| ids.contains(&edge.source) && ids.contains(&edge.target))
                .collect();
            ok(json!({ "ok": true, "projectId": project.id, "nodes": nodes, "edges": edges }))
        }
        Err(error) => err(500, error),
    }
}

fn build_graph(project_path: &str) -> Result<(Vec<ApiGraphNode>, Vec<ApiGraphEdge>), String> {
    let wiki_root = Path::new(project_path).join("wiki");
    let mut raw: BTreeMap<String, (String, String, String, Vec<String>)> = BTreeMap::new();
    for entry in WalkDir::new(&wiki_root).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("md")
        {
            continue;
        }
        let content = match fs::read_to_string(entry.path()) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let parsed = parse_graph_document(&content, entry.file_name().to_string_lossy().as_ref());
        if parsed.id.is_empty() {
            continue;
        }
        let path = relative_to_project(project_path, entry.path());
        let ParsedGraphDocument {
            id,
            title,
            node_type,
            sources,
            links,
        } = parsed;
        let _ = sources;
        raw.insert(id, (title, node_type, path, links));
    }
    raw.retain(|_, (_, node_type, _, _)| node_type != "query");
    let ids: BTreeSet<String> = raw.keys().cloned().collect();
    let mut link_count: BTreeMap<String, usize> = raw.keys().map(|id| (id.clone(), 0)).collect();
    let mut seen = BTreeSet::new();
    let mut edges = Vec::new();
    for (source, (_, _, _, links)) in &raw {
        for link in links {
            let Some(target) = resolve_link(link, &ids) else {
                continue;
            };
            if &target == source {
                continue;
            }
            let key = if source < &target {
                format!("{source}::{target}")
            } else {
                format!("{target}::{source}")
            };
            if seen.insert(key) {
                *link_count.entry(source.clone()).or_default() += 1;
                *link_count.entry(target.clone()).or_default() += 1;
                edges.push(ApiGraphEdge {
                    source: source.clone(),
                    target,
                    weight: 1.0,
                });
            }
        }
    }
    let nodes = raw
        .into_iter()
        .map(|(id, (label, node_type, path, _))| ApiGraphNode {
            link_count: *link_count.get(&id).unwrap_or(&0),
            id,
            label,
            node_type,
            path,
        })
        .collect();
    Ok((nodes, edges))
}

fn wiki_file_name_to_id(file_name: &str) -> String {
    file_name.trim_end_matches(".md").to_string()
}

fn extract_frontmatter(content: &str) -> Option<&str> {
    let stripped = content.strip_prefix("---\n")?;
    let end = stripped.find("\n---")?;
    Some(&stripped[..end])
}

fn extract_frontmatter_field(frontmatter: &str, field: &str) -> Option<String> {
    for line in frontmatter.lines() {
        if let Some(value) = line.trim().strip_prefix(&format!("{field}:")) {
            return Some(
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            );
        }
    }
    None
}

fn extract_sources(frontmatter: &str) -> Vec<String> {
    let mut sources = Vec::new();
    let mut lines = frontmatter.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.starts_with("sources:") {
            let inline = trimmed.trim_start_matches("sources:").trim();
            if inline.starts_with('[') && inline.ends_with(']') {
                for item in inline
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .split(',')
                {
                    let value = item.trim().trim_matches('"').trim_matches('\'');
                    if !value.is_empty() {
                        sources.push(value.to_string());
                    }
                }
                return sources;
            }

            while let Some(next_line) = lines.peek() {
                let candidate = next_line.trim();
                if candidate.is_empty() {
                    lines.next();
                    continue;
                }
                if next_line.starts_with(' ') || next_line.starts_with('\t') {
                    if let Some(value) = candidate.strip_prefix('-') {
                        let value = value.trim().trim_matches('"').trim_matches('\'');
                        if !value.is_empty() {
                            sources.push(value.to_string());
                        }
                    }
                    lines.next();
                    continue;
                }
                break;
            }
            return sources;
        }
    }
    sources
}

fn extract_type(content: &str) -> String {
    extract_frontmatter(content)
        .and_then(|frontmatter| extract_frontmatter_field(frontmatter, "type"))
        .map(|value| value.to_lowercase())
        .unwrap_or_else(|| "other".to_string())
}

fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let inner = &rest[..end];
        let target = inner.split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = &rest[end + 2..];
    }
    out
}

fn parse_graph_document(content: &str, file_name: &str) -> ParsedGraphDocument {
    let frontmatter = extract_frontmatter(content);
    let title = frontmatter
        .and_then(|fm| extract_frontmatter_field(fm, "title"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| commands::search::extract_title(content, file_name));

    ParsedGraphDocument {
        id: wiki_file_name_to_id(file_name),
        title,
        node_type: extract_type(content),
        sources: frontmatter.map(extract_sources).unwrap_or_default(),
        links: extract_wikilinks(content),
    }
}

fn resolve_link(raw: &str, ids: &BTreeSet<String>) -> Option<String> {
    if ids.contains(raw) {
        return Some(raw.to_string());
    }
    let normalized = raw.to_lowercase().replace(' ', "-");
    ids.iter()
        .find(|id| id.to_lowercase() == normalized)
        .cloned()
        .or_else(|| {
            ids.iter()
                .find(|id| id.to_lowercase() == raw.to_lowercase())
                .cloned()
        })
        .or_else(|| {
            ids.iter()
                .find(|id| id.to_lowercase().replace(' ', "-") == normalized)
                .cloned()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extract_type_reads_frontmatter_type_and_defaults_to_other() {
        let typed = "---\ntype: Concept\n---\n# Title";
        assert_eq!(extract_type(typed), "concept");

        let missing = "# Title\nBody";
        assert_eq!(extract_type(missing), "other");

        let body_field_only = "# Title\ntype: Body field only";
        assert_eq!(extract_type(body_field_only), "other");
    }

    #[test]
    fn extract_wikilinks_collects_targets_and_ignores_aliases() {
        let content = "See [[Attention Is All You Need|paper]] and [[knowledge-graph]].";
        assert_eq!(
            extract_wikilinks(content),
            vec![
                "Attention Is All You Need".to_string(),
                "knowledge-graph".to_string()
            ]
        );
    }

    #[test]
    fn resolve_link_matches_exact_and_normalized_forms() {
        let ids = BTreeSet::from([
            "attention-is-all-you-need".to_string(),
            "knowledge-graph".to_string(),
        ]);

        assert_eq!(
            resolve_link("knowledge-graph", &ids).as_deref(),
            Some("knowledge-graph")
        );
        assert_eq!(
            resolve_link("Attention Is All You Need", &ids).as_deref(),
            Some("attention-is-all-you-need")
        );
        assert_eq!(
            resolve_link("attention-is-all-you-need", &ids).as_deref(),
            Some("attention-is-all-you-need")
        );
        let spaced_ids = BTreeSet::from(["attention is all you need".to_string()]);
        assert_eq!(
            resolve_link("attention-is-all-you-need", &spaced_ids).as_deref(),
            Some("attention is all you need")
        );
        assert_eq!(resolve_link("missing", &ids), None);
    }

    #[test]
    fn parse_graph_document_matches_ts_helper_semantics() {
        let content = r#"---
title: "Attention Is All You Need"
type: concept
sources:
  - "paper.pdf"
  - notes.md
---

[[transformer-architecture]]
[[BERT|model]]
"#;

        let parsed = parse_graph_document(content, "attention-is-all-you-need.md");
        assert_eq!(parsed.id, "attention-is-all-you-need");
        assert_eq!(parsed.title, "Attention Is All You Need");
        assert_eq!(parsed.node_type, "concept");
        assert_eq!(
            parsed.sources,
            vec!["paper.pdf".to_string(), "notes.md".to_string()]
        );
        assert_eq!(
            parsed.links,
            vec!["transformer-architecture".to_string(), "BERT".to_string()]
        );

        let fallback = parse_graph_document("plain body", "kv-cache.md");
        assert_eq!(fallback.title, "kv cache");
        assert_eq!(fallback.node_type, "other");
        assert!(fallback.sources.is_empty());
        assert!(fallback.links.is_empty());
    }

    fn graph_contract_fixture_root() -> String {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/test-fixtures/graph-contract")
            .to_string_lossy()
            .replace('\\', "/")
    }

    #[test]
    fn build_graph_matches_shared_contract_fixture() {
        let fixture_root = graph_contract_fixture_root();
        let (mut nodes, mut edges) =
            build_graph(&fixture_root).expect("graph fixture should parse");

        nodes.sort_by(|left, right| left.id.cmp(&right.id));
        let node_summary: Vec<(String, String, String)> = nodes
            .iter()
            .map(|node| (node.id.clone(), node.label.clone(), node.node_type.clone()))
            .collect();
        assert_eq!(
            node_summary,
            vec![
                (
                    "attention-is-all-you-need".to_string(),
                    "Attention Is All You Need".to_string(),
                    "concept".to_string()
                ),
                ("bert".to_string(), "BERT".to_string(), "entity".to_string()),
                (
                    "transformer-architecture".to_string(),
                    "Transformer Architecture".to_string(),
                    "concept".to_string()
                ),
            ]
        );

        let mut edge_summary: Vec<String> = edges
            .drain(..)
            .map(|edge| {
                let mut pair = [edge.source, edge.target];
                pair.sort();
                format!("{}::{}", pair[0], pair[1])
            })
            .collect();
        edge_summary.sort();
        assert_eq!(
            edge_summary,
            vec![
                "attention-is-all-you-need::bert".to_string(),
                "attention-is-all-you-need::transformer-architecture".to_string(),
            ]
        );
    }
}
