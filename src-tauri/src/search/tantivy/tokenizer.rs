use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera_tantivy::tokenizer::LinderaTokenizer;
use tantivy::Index;

use crate::search::SearchError;

pub(super) const TOKENIZER_NAME: &str = "glimpse_lindera_ja";

pub(super) fn register_lindera_tokenizer(index: &Index) -> Result<(), SearchError> {
    let dictionary = load_dictionary("embedded://ipadic")
        .map_err(|error| SearchError::IndexError(error.to_string()))?;
    let segmenter = Segmenter::new(Mode::Normal, dictionary, None);
    let tokenizer = LinderaTokenizer::from_segmenter(segmenter);

    index.tokenizers().register(TOKENIZER_NAME, tokenizer);

    Ok(())
}
