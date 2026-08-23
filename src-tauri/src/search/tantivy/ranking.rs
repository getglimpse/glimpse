use crate::search::{SearchSnippet, SearchSnippetSource};

pub(super) const TITLE_FIELD_BOOST: f32 = 3.0;
pub(super) const TAG_FIELD_BOOST: f32 = 2.0;
pub(super) const ALIASES_FIELD_BOOST: f32 = 2.0;
pub(super) const BODY_FIELD_BOOST: f32 = 1.0;
pub(super) const CHUNK_ITEM_CONTEXT_FIELD_BOOST: f32 = 1.0;
pub(super) const DEFAULT_METADATA_BOOST: f32 = 1.0;
pub(super) const IDENTITY_QUERY_BOOST: f32 = 1.0;

const UNSTARRED_ITEM_SCORE_BOOST: f32 = 0.0;
const STARRED_ITEM_SCORE_BOOST: f32 = 10_000.0;
const RECENCY_SCORE_DIVISOR: f32 = 1_000_000_000.0;
const MIN_RECENCY_SCORE_BOOST: f32 = 0.0;

pub(super) struct ItemHitAccumulator {
    limit: usize,
    hits: Vec<AccumulatedItemHit>,
}

struct AccumulatedItemHit {
    item_id: String,
    score: f32,
    snippet_candidate: Option<SnippetCandidate>,
}

pub(super) struct RankedItemHit {
    pub item_id: String,
    pub score: f32,
    pub snippets: Option<Vec<SearchSnippet>>,
}

pub(super) struct SnippetCandidate {
    snippet: SearchSnippet,
    source_priority: u8,
    score: f32,
}

impl SnippetCandidate {
    pub(super) fn new(snippet: SearchSnippet, score: f32) -> Self {
        let source_priority = snippet_source_priority(&snippet.source);

        Self {
            snippet,
            source_priority,
            score,
        }
    }

    fn is_better_than(&self, other: &Self) -> bool {
        self.source_priority > other.source_priority
            || (self.source_priority == other.source_priority && self.score > other.score)
    }

    fn into_snippets(self) -> Vec<SearchSnippet> {
        vec![self.snippet]
    }
}

impl ItemHitAccumulator {
    pub(super) fn new(limit: usize) -> Self {
        Self {
            limit,
            hits: Vec::new(),
        }
    }

    pub(super) fn push(
        &mut self,
        item_id: String,
        score: f32,
        snippet_candidate: Option<SnippetCandidate>,
    ) {
        if let Some(hit) = self.hits.iter_mut().find(|hit| hit.item_id == item_id) {
            hit.score = hit.score.max(score);
            retain_best_snippet_candidate(&mut hit.snippet_candidate, snippet_candidate);
            return;
        }

        self.hits.push(AccumulatedItemHit {
            item_id,
            score,
            snippet_candidate,
        });
    }

    pub(super) fn is_full(&self) -> bool {
        self.hits.len() >= self.limit
    }

    pub(super) fn len(&self) -> usize {
        self.hits.len()
    }

    pub(super) fn into_hits(mut self) -> Vec<RankedItemHit> {
        self.hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self.hits.truncate(self.limit);

        self.hits
            .into_iter()
            .map(|hit| RankedItemHit {
                item_id: hit.item_id,
                score: hit.score,
                snippets: hit.snippet_candidate.map(SnippetCandidate::into_snippets),
            })
            .collect()
    }
}

fn retain_best_snippet_candidate(
    current: &mut Option<SnippetCandidate>,
    candidate: Option<SnippetCandidate>,
) {
    let Some(candidate) = candidate else {
        return;
    };

    if current
        .as_ref()
        .map(|current| candidate.is_better_than(current))
        .unwrap_or(true)
    {
        *current = Some(candidate);
    }
}

fn snippet_source_priority(source: &SearchSnippetSource) -> u8 {
    match source {
        SearchSnippetSource::Body => 3,
        SearchSnippetSource::Alias => 2,
        SearchSnippetSource::Tag => 1,
        SearchSnippetSource::Title => 0,
    }
}

pub(super) fn adjusted_score(score: f32, star: bool, updated_at: i64, boost: f32) -> f32 {
    let star_boost = if star {
        STARRED_ITEM_SCORE_BOOST
    } else {
        UNSTARRED_ITEM_SCORE_BOOST
    };
    let recency_boost = (updated_at as f32 / RECENCY_SCORE_DIVISOR).max(MIN_RECENCY_SCORE_BOOST);

    (score * boost) + star_boost + recency_boost
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::search::SearchSnippetFragment;

    fn snippet(source: SearchSnippetSource, text: &str) -> SearchSnippet {
        SearchSnippet {
            source,
            fragments: vec![SearchSnippetFragment {
                text: text.to_string(),
                matched: true,
            }],
            chunk: None,
        }
    }

    #[test]
    fn item_hit_accumulator_keeps_best_score_per_item() {
        let mut hits = ItemHitAccumulator::new(10);

        hits.push("item-1".to_string(), 1.0, None);
        hits.push("item-1".to_string(), 3.0, None);
        hits.push("item-2".to_string(), 2.0, None);

        let hits = hits.into_hits();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].item_id, "item-1");
        assert_eq!(hits[0].score, 3.0);
        assert_eq!(hits[1].item_id, "item-2");
        assert_eq!(hits[1].score, 2.0);
    }

    #[test]
    fn item_hit_accumulator_truncates_after_sorting_by_score() {
        let mut hits = ItemHitAccumulator::new(2);

        hits.push("item-1".to_string(), 1.0, None);
        hits.push("item-2".to_string(), 3.0, None);
        hits.push("item-3".to_string(), 2.0, None);

        let hits = hits.into_hits();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].item_id, "item-2");
        assert_eq!(hits[1].item_id, "item-3");
    }

    #[test]
    fn item_hit_accumulator_keeps_snippet_when_best_score_has_none() {
        let mut hits = ItemHitAccumulator::new(10);

        hits.push(
            "item-1".to_string(),
            1.0,
            Some(SnippetCandidate::new(
                snippet(SearchSnippetSource::Body, "body"),
                1.0,
            )),
        );
        hits.push("item-1".to_string(), 3.0, None);

        let hits = hits.into_hits();

        assert_eq!(hits[0].score, 3.0);
        assert_eq!(
            hits[0].snippets.as_ref().unwrap()[0].fragments[0].text,
            "body"
        );
    }

    #[test]
    fn item_hit_accumulator_prefers_body_snippet_candidate() {
        let mut hits = ItemHitAccumulator::new(10);

        hits.push(
            "item-1".to_string(),
            10.0,
            Some(SnippetCandidate::new(
                snippet(SearchSnippetSource::Tag, "tag"),
                10.0,
            )),
        );
        hits.push(
            "item-1".to_string(),
            1.0,
            Some(SnippetCandidate::new(
                snippet(SearchSnippetSource::Body, "body"),
                1.0,
            )),
        );

        let hits = hits.into_hits();

        assert_eq!(hits[0].score, 10.0);
        assert_eq!(
            hits[0].snippets.as_ref().unwrap()[0].fragments[0].text,
            "body"
        );
    }
}
