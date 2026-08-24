use crate::models::{IndexItem, Preview};

const MAX_CHUNK_BYTES: usize = 8 * 1024;
const CHUNK_OVERLAP_BYTES: usize = 512;
const MIN_BOUNDARY_BYTES: usize = MAX_CHUNK_BYTES / 2;

pub(super) struct IndexChunk<'a> {
    item: &'a IndexItem,
    body: &'a str,
    ordinal: usize,
    start_byte: usize,
    end_byte: usize,
}

impl<'a> IndexChunk<'a> {
    fn new(item: &'a IndexItem, body: &'a str, ordinal: usize, start_byte: usize) -> Self {
        Self {
            item,
            body,
            ordinal,
            start_byte,
            end_byte: start_byte + body.len(),
        }
    }

    pub(super) fn item(&self) -> &'a IndexItem {
        self.item
    }

    pub(super) fn body(&self) -> &'a str {
        self.body
    }

    pub(super) fn ordinal(&self) -> usize {
        self.ordinal
    }

    pub(super) fn start_byte(&self) -> usize {
        self.start_byte
    }

    pub(super) fn end_byte(&self) -> usize {
        self.end_byte
    }
}

pub(super) fn item_index_chunks(item: &IndexItem) -> Vec<IndexChunk<'_>> {
    let body = preview_body(item);

    if body.is_empty() || body.len() <= MAX_CHUNK_BYTES {
        return vec![IndexChunk::new(item, body, 0, 0)];
    }

    let mut chunks = Vec::new();
    let mut start_byte = 0;

    while start_byte < body.len() {
        let hard_end = floor_char_boundary(
            body,
            start_byte.saturating_add(MAX_CHUNK_BYTES).min(body.len()),
        );
        let end_byte = if hard_end >= body.len() {
            body.len()
        } else {
            choose_chunk_end(body, start_byte, hard_end)
        };

        chunks.push(IndexChunk::new(
            item,
            &body[start_byte..end_byte],
            chunks.len(),
            start_byte,
        ));

        if end_byte >= body.len() {
            break;
        }

        let overlap_start = floor_char_boundary(
            body,
            end_byte.saturating_sub(CHUNK_OVERLAP_BYTES).max(start_byte),
        );

        start_byte = if overlap_start <= start_byte {
            end_byte
        } else {
            overlap_start
        };
    }

    chunks
}

fn preview_body(item: &IndexItem) -> &str {
    if let Some(content) = item.search_content.as_deref() {
        return content;
    }

    match &item.preview {
        Preview::Markdown { content } | Preview::Raw { content } => content.as_str(),
        Preview::External { .. } | Preview::PluginViewer { .. } => "",
    }
}

fn choose_chunk_end(text: &str, start_byte: usize, hard_end: usize) -> usize {
    let min_end = floor_char_boundary(
        text,
        start_byte.saturating_add(MIN_BOUNDARY_BYTES).min(hard_end),
    );

    heading_boundary(text, start_byte, min_end, hard_end)
        .or_else(|| paragraph_boundary(text, start_byte, min_end, hard_end))
        .or_else(|| line_boundary(text, start_byte, min_end, hard_end))
        .or_else(|| sentence_boundary(text, start_byte, min_end, hard_end))
        .or_else(|| whitespace_boundary(text, start_byte, min_end, hard_end))
        .unwrap_or(hard_end)
}

fn heading_boundary(
    text: &str,
    start_byte: usize,
    min_end: usize,
    hard_end: usize,
) -> Option<usize> {
    line_start_boundaries(text, start_byte, hard_end)
        .into_iter()
        .filter(|boundary| *boundary >= min_end && is_markdown_heading_start(text, *boundary))
        .last()
}

fn paragraph_boundary(
    text: &str,
    start_byte: usize,
    min_end: usize,
    hard_end: usize,
) -> Option<usize> {
    boundary_after_patterns(text, start_byte, min_end, hard_end, &["\r\n\r\n", "\n\n"])
}

fn line_boundary(text: &str, start_byte: usize, min_end: usize, hard_end: usize) -> Option<usize> {
    boundary_after_patterns(text, start_byte, min_end, hard_end, &["\n"])
}

fn sentence_boundary(
    text: &str,
    start_byte: usize,
    min_end: usize,
    hard_end: usize,
) -> Option<usize> {
    text[start_byte..hard_end]
        .char_indices()
        .filter_map(|(relative, ch)| {
            if !is_sentence_terminal(ch) {
                return None;
            }

            let boundary = start_byte + relative + ch.len_utf8();
            (boundary >= min_end && boundary <= hard_end).then_some(boundary)
        })
        .last()
}

fn is_sentence_terminal(ch: char) -> bool {
    matches!(ch, '。' | '．' | '！' | '？' | '｡' | '!' | '?' | '.')
}

fn whitespace_boundary(
    text: &str,
    start_byte: usize,
    min_end: usize,
    hard_end: usize,
) -> Option<usize> {
    text[start_byte..hard_end]
        .char_indices()
        .filter_map(|(relative, ch)| {
            if !ch.is_whitespace() {
                return None;
            }

            let boundary = start_byte + relative + ch.len_utf8();
            (boundary >= min_end && boundary <= hard_end).then_some(boundary)
        })
        .last()
}

fn boundary_after_patterns(
    text: &str,
    start_byte: usize,
    min_end: usize,
    hard_end: usize,
    patterns: &[&str],
) -> Option<usize> {
    patterns
        .iter()
        .flat_map(|pattern| {
            text[start_byte..hard_end]
                .match_indices(pattern)
                .map(move |(relative, value)| start_byte + relative + value.len())
        })
        .filter(|boundary| *boundary >= min_end && *boundary <= hard_end)
        .max()
}

fn line_start_boundaries(text: &str, start_byte: usize, hard_end: usize) -> Vec<usize> {
    text[start_byte..hard_end]
        .match_indices('\n')
        .filter_map(|(relative, _)| {
            let boundary = start_byte + relative + '\n'.len_utf8();
            (boundary > start_byte && boundary < hard_end).then_some(boundary)
        })
        .collect()
}

fn is_markdown_heading_start(text: &str, start_byte: usize) -> bool {
    let line_end = text[start_byte..]
        .find('\n')
        .map(|relative| start_byte + relative)
        .unwrap_or(text.len());
    let line = &text[start_byte..line_end];
    let trimmed = line.trim_start_matches(' ');
    let indentation = line.len() - trimmed.len();

    if indentation > 3 {
        return false;
    }

    let hash_count = trimmed.chars().take_while(|ch| *ch == '#').count();

    if !(1..=6).contains(&hash_count) {
        return false;
    }

    trimmed[hash_count..]
        .chars()
        .next()
        .map(|ch| ch.is_whitespace())
        .unwrap_or(true)
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    index = index.min(text.len());

    while !text.is_char_boundary(index) {
        index -= 1;
    }

    index
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    fn item_with_preview(preview: Preview) -> IndexItem {
        IndexItem::new("item-1", "Chunk Test", Utc::now(), preview)
    }

    #[test]
    fn short_body_uses_one_searchable_preview_chunk() {
        let item = item_with_preview(Preview::Markdown {
            content: "searchable body".to_string(),
        });

        let chunks = item_index_chunks(&item);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].item().id, "item-1");
        assert_eq!(chunks[0].body(), "searchable body");
        assert_eq!(chunks[0].ordinal(), 0);
        assert_eq!(chunks[0].start_byte(), 0);
        assert_eq!(chunks[0].end_byte(), "searchable body".len());
    }

    #[test]
    fn non_text_preview_chunk_uses_empty_body() {
        let item = item_with_preview(Preview::External {
            url: "https://example.com".to_string(),
        });

        let chunks = item_index_chunks(&item);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].body(), "");
    }

    #[test]
    fn long_body_splits_into_overlapping_chunks_with_stable_offsets() {
        let content = format!(
            "{} {} {}",
            "alpha ".repeat(900),
            "beta ".repeat(900),
            "gamma ".repeat(900)
        );
        let item = item_with_preview(Preview::Markdown {
            content: content.clone(),
        });

        let chunks = item_index_chunks(&item);

        assert!(chunks.len() > 1);

        for (index, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.ordinal(), index);
            assert!(content.is_char_boundary(chunk.start_byte()));
            assert!(content.is_char_boundary(chunk.end_byte()));
            assert_eq!(chunk.body(), &content[chunk.start_byte()..chunk.end_byte()]);
            assert!(chunk.body().len() <= MAX_CHUNK_BYTES);
        }

        for pair in chunks.windows(2) {
            assert!(pair[0].start_byte() < pair[1].start_byte());
            assert!(pair[1].start_byte() < pair[0].end_byte());
            assert!(pair[0].end_byte() - pair[1].start_byte() <= CHUNK_OVERLAP_BYTES);
        }
    }

    #[test]
    fn splitter_prefers_markdown_heading_boundaries() {
        let content = format!(
            "{}\n# Next Section\n{}",
            "intro ".repeat((MIN_BOUNDARY_BYTES / "intro ".len()) + 8),
            "details ".repeat(1200)
        );
        let heading_start = content.find("# Next Section").unwrap();
        let item = item_with_preview(Preview::Markdown {
            content: content.clone(),
        });

        let chunks = item_index_chunks(&item);

        assert!(chunks.len() > 1);
        assert_eq!(chunks[0].end_byte(), heading_start);
        assert_eq!(chunks[0].body(), &content[..heading_start]);
    }

    #[test]
    fn splitter_prefers_paragraph_boundaries() {
        let first_paragraph = "paragraph ".repeat((MIN_BOUNDARY_BYTES / "paragraph ".len()) + 8);
        let content = format!("{first_paragraph}\n\n{}", "second paragraph ".repeat(1000));
        let paragraph_end = first_paragraph.len() + "\n\n".len();
        let item = item_with_preview(Preview::Markdown {
            content: content.clone(),
        });

        let chunks = item_index_chunks(&item);

        assert!(chunks.len() > 1);
        assert_eq!(chunks[0].end_byte(), paragraph_end);
        assert_eq!(chunks[0].body(), &content[..paragraph_end]);
    }

    #[test]
    fn splitter_prefers_sentence_boundaries_for_cjk_text_without_spaces() {
        let sentence = format!("nihongochunk{}", '\u{3002}');
        let content = sentence.repeat((MAX_CHUNK_BYTES / sentence.len()) + 12);
        let item = item_with_preview(Preview::Markdown {
            content: content.clone(),
        });

        let chunks = item_index_chunks(&item);

        assert!(chunks.len() > 1);
        assert!(chunks[0].end_byte() < MAX_CHUNK_BYTES);
        assert!(chunks[0].body().ends_with('\u{3002}'));
        assert_eq!(chunks[0].body(), &content[..chunks[0].end_byte()]);
    }

    #[test]
    fn splitter_keeps_utf8_byte_offsets_valid_for_mixed_text() {
        let content = format!(
            "{} {}",
            "日本語とEnglishのmixed本文。".repeat(420),
            "末尾の検索語"
        );
        let item = item_with_preview(Preview::Markdown {
            content: content.clone(),
        });

        let chunks = item_index_chunks(&item);

        assert!(chunks.len() > 1);

        for chunk in chunks {
            assert!(content.is_char_boundary(chunk.start_byte()));
            assert!(content.is_char_boundary(chunk.end_byte()));
            assert_eq!(chunk.body(), &content[chunk.start_byte()..chunk.end_byte()]);
        }
    }
}
