use std::path::Path;

use crate::domain::git::file_size::{bytes_have_binary_marker, LARGE_FILE_BYTES};
use crate::domain::git::models::{
    ConflictContent, ConflictContentUnavailableReason, ConflictFileKind, ConflictIndexEntryContent,
    ConflictResultContent,
};
use crate::shared::git_cli::{run_git_safe_refs, run_git_safe_refs_bytes};

use super::fingerprint::ConflictStageFingerprint;

pub(super) async fn read_index_entry(
    repo: &Path,
    stage: &ConflictStageFingerprint,
) -> ConflictIndexEntryContent {
    let file_kind = file_kind_from_mode(&stage.mode);
    let size = object_size(repo, &stage.object_id).await;
    let content = match (file_kind, size) {
        (kind, _) if kind != ConflictFileKind::RegularFile => ConflictContent::Unavailable {
            reason: ConflictContentUnavailableReason::UnsupportedFileKind,
        },
        (_, Err(reason)) => ConflictContent::Unavailable { reason },
        (_, Ok(byte_size)) if byte_size >= LARGE_FILE_BYTES => ConflictContent::Large,
        (_, Ok(_)) => {
            match run_git_safe_refs_bytes(&["cat-file", "blob"], &[], &[&stage.object_id], repo)
                .await
            {
                Ok(bytes) => classify_bytes(bytes),
                Err(_) => ConflictContent::Unavailable {
                    reason: ConflictContentUnavailableReason::ObjectMissing,
                },
            }
        }
    };
    ConflictIndexEntryContent {
        object_id: stage.object_id.clone(),
        file_kind,
        byte_size: size.ok(),
        content,
    }
}

pub(super) async fn read_result(repo: &Path, file_path: &str) -> Option<ConflictResultContent> {
    let path = repo.join(file_path);
    let metadata = match tokio::fs::symlink_metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => {
            return Some(ConflictResultContent {
                file_kind: ConflictFileKind::Other,
                byte_size: None,
                content: ConflictContent::Unavailable {
                    reason: ConflictContentUnavailableReason::ReadFailed,
                },
            });
        }
    };
    let file_kind = file_kind_from_metadata(&metadata);
    let byte_size = metadata.is_file().then_some(metadata.len());
    let content = if file_kind != ConflictFileKind::RegularFile {
        ConflictContent::Unavailable {
            reason: ConflictContentUnavailableReason::UnsupportedFileKind,
        }
    } else if metadata.len() >= LARGE_FILE_BYTES {
        ConflictContent::Large
    } else {
        match tokio::fs::read(path).await {
            Ok(bytes) => classify_bytes(bytes),
            Err(_) => ConflictContent::Unavailable {
                reason: ConflictContentUnavailableReason::ReadFailed,
            },
        }
    };
    Some(ConflictResultContent {
        file_kind,
        byte_size,
        content,
    })
}

async fn object_size(
    repo: &Path,
    object_id: &str,
) -> Result<u64, ConflictContentUnavailableReason> {
    let output = run_git_safe_refs(&["cat-file"], &["-s"], &[object_id], repo)
        .await
        .map_err(|_| ConflictContentUnavailableReason::ObjectMissing)?;
    output
        .trim()
        .parse::<u64>()
        .map_err(|_| ConflictContentUnavailableReason::ReadFailed)
}

fn classify_bytes(bytes: Vec<u8>) -> ConflictContent {
    if bytes_have_binary_marker(&bytes) {
        return ConflictContent::Binary;
    }
    match String::from_utf8(bytes) {
        Ok(content) => ConflictContent::Text { content },
        Err(_) => ConflictContent::Binary,
    }
}

fn file_kind_from_mode(mode: &str) -> ConflictFileKind {
    match mode {
        "100644" | "100755" => ConflictFileKind::RegularFile,
        "120000" => ConflictFileKind::Symlink,
        "160000" => ConflictFileKind::Gitlink,
        _ => ConflictFileKind::Other,
    }
}

fn file_kind_from_metadata(metadata: &std::fs::Metadata) -> ConflictFileKind {
    if metadata.file_type().is_symlink() {
        ConflictFileKind::Symlink
    } else if metadata.is_file() {
        ConflictFileKind::RegularFile
    } else {
        ConflictFileKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_content_classification_never_lossily_decodes_binary() {
        assert_eq!(
            classify_bytes(b"hello\0world".to_vec()),
            ConflictContent::Binary
        );
        assert_eq!(classify_bytes(vec![0xff, 0xfe]), ConflictContent::Binary);
        assert_eq!(
            classify_bytes(b"text\n".to_vec()),
            ConflictContent::Text {
                content: "text\n".into()
            }
        );
    }

    #[test]
    fn git_modes_map_to_public_file_kinds() {
        assert_eq!(file_kind_from_mode("100755"), ConflictFileKind::RegularFile);
        assert_eq!(file_kind_from_mode("120000"), ConflictFileKind::Symlink);
        assert_eq!(file_kind_from_mode("160000"), ConflictFileKind::Gitlink);
        assert_eq!(file_kind_from_mode("100664"), ConflictFileKind::Other);
    }
}
