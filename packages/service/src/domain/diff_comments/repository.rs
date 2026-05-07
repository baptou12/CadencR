use sqlx::SqlitePool;

use super::models::*;
use crate::error::AppError;

// ---- Diff Comments ----

pub async fn list_by_feature(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<DiffComment>, AppError> {
    Ok(sqlx::query_as::<_, DiffComment>(
        "SELECT id, feature_id, file_path, line_number, side, content, status, created_at, original_blob_sha
         FROM diff_comments WHERE feature_id = ? ORDER BY file_path, line_number ASC",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?)
}

pub async fn create(
    pool: &SqlitePool,
    req: &CreateDiffCommentRequest,
) -> Result<DiffComment, AppError> {
    let id = sqlx::query(
        "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status, original_blob_sha)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    )
    .bind(req.feature_id)
    .bind(&req.file_path)
    .bind(req.line_number)
    .bind(&req.side)
    .bind(&req.content)
    .bind(req.original_blob_sha.as_deref())
    .execute(pool)
    .await?
    .last_insert_rowid();

    Ok(sqlx::query_as::<_, DiffComment>(
        "SELECT id, feature_id, file_path, line_number, side, content, status, created_at, original_blob_sha
         FROM diff_comments WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?)
}

pub async fn update(pool: &SqlitePool, id: i64, content: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE diff_comments SET content = ? WHERE id = ?")
        .bind(content)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM diff_comments WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_as_sent(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "UPDATE diff_comments SET status = 'sent' WHERE feature_id = ? AND status = 'pending'",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub async fn delete_pending(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result =
        sqlx::query("DELETE FROM diff_comments WHERE feature_id = ? AND status = 'pending'")
            .bind(feature_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected())
}

// ---- Diff Viewed ----

pub async fn list_viewed_by_feature(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<DiffViewedFile>, AppError> {
    let rows: Vec<(i64, i64, String, String, String)> = sqlx::query_as(
        "SELECT id, feature_id, file_path, blob_sha, viewed_at
         FROM diff_viewed_files WHERE feature_id = ? ORDER BY file_path ASC",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, feature_id, file_path, blob_sha, viewed_at)| DiffViewedFile {
                id,
                feature_id,
                file_path,
                blob_sha,
                viewed_at,
            },
        )
        .collect())
}

pub async fn mark_viewed(
    pool: &SqlitePool,
    feature_id: i64,
    file_path: &str,
    blob_sha: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO diff_viewed_files (feature_id, file_path, blob_sha, viewed_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(feature_id, file_path) DO UPDATE SET blob_sha = excluded.blob_sha, viewed_at = excluded.viewed_at",
    )
    .bind(feature_id)
    .bind(file_path)
    .bind(blob_sha)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unmark_viewed(
    pool: &SqlitePool,
    feature_id: i64,
    file_path: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ? AND file_path = ?")
        .bind(feature_id)
        .bind(file_path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_all_viewed(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result = sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE features (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE diff_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                side TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                original_blob_sha TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE diff_viewed_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                blob_sha TEXT NOT NULL,
                viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(feature_id, file_path)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Insert a project + feature to use in tests
        sqlx::query(
            "INSERT INTO projects (id, name, path) VALUES (1, 'Test Project', '/tmp/test')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'Test Feature')")
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    async fn create_comment(
        pool: &SqlitePool,
        feature_id: i64,
        file_path: &str,
        content: &str,
    ) -> DiffComment {
        let req = CreateDiffCommentRequest {
            feature_id,
            file_path: file_path.to_string(),
            line_number: 10,
            side: "RIGHT".to_string(),
            content: content.to_string(),
            original_blob_sha: None,
        };
        create(pool, &req).await.unwrap()
    }

    // ---- Diff Comments tests ----

    #[tokio::test]
    async fn test_create_and_list_comments() {
        let pool = setup_test_db().await;
        create_comment(&pool, 1, "src/main.rs", "First comment").await;
        create_comment(&pool, 1, "src/lib.rs", "Second comment").await;

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 2);
        let contents: Vec<&str> = comments.iter().map(|c| c.content.as_str()).collect();
        assert!(contents.contains(&"First comment"));
        assert!(contents.contains(&"Second comment"));
        assert!(comments.iter().all(|c| c.status == "pending"));
        assert!(comments.iter().all(|c| c.feature_id == 1));
    }

    #[tokio::test]
    async fn test_list_comments_empty() {
        let pool = setup_test_db().await;
        let comments = list_by_feature(&pool, 999).await.unwrap();
        assert!(comments.is_empty());
    }

    #[tokio::test]
    async fn test_update_comment() {
        let pool = setup_test_db().await;
        let comment = create_comment(&pool, 1, "src/main.rs", "Original").await;

        update(&pool, comment.id, "Updated content").await.unwrap();

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].content, "Updated content");
    }

    #[tokio::test]
    async fn test_delete_comment() {
        let pool = setup_test_db().await;
        let comment = create_comment(&pool, 1, "src/main.rs", "To delete").await;

        delete(&pool, comment.id).await.unwrap();

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert!(comments.is_empty());
    }

    #[tokio::test]
    async fn test_mark_as_sent() {
        let pool = setup_test_db().await;
        create_comment(&pool, 1, "a.rs", "c1").await;
        create_comment(&pool, 1, "b.rs", "c2").await;
        create_comment(&pool, 1, "c.rs", "c3").await;

        let affected = mark_as_sent(&pool, 1).await.unwrap();
        assert_eq!(affected, 3);

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert!(comments.iter().all(|c| c.status == "sent"));
    }

    #[tokio::test]
    async fn test_mark_as_sent_only_pending() {
        let pool = setup_test_db().await;
        let pending = create_comment(&pool, 1, "a.rs", "pending").await;
        // Manually insert a 'sent' comment
        sqlx::query(
            "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status) VALUES (1, 'b.rs', 5, 'LEFT', 'already sent', 'sent')"
        ).execute(&pool).await.unwrap();

        let affected = mark_as_sent(&pool, 1).await.unwrap();
        assert_eq!(affected, 1); // Only the pending one

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 2);
        assert!(comments.iter().all(|c| c.status == "sent"));

        let _ = pending;
    }

    #[tokio::test]
    async fn test_create_and_list_preserves_original_blob_sha() {
        let pool = setup_test_db().await;
        let req = CreateDiffCommentRequest {
            feature_id: 1,
            file_path: "src/main.rs".to_string(),
            line_number: 5,
            side: "RIGHT".to_string(),
            content: "with sha".to_string(),
            original_blob_sha: Some("abc123sha".to_string()),
        };
        let created = create(&pool, &req).await.unwrap();
        assert_eq!(created.original_blob_sha.as_deref(), Some("abc123sha"));

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].original_blob_sha.as_deref(), Some("abc123sha"));
    }

    #[tokio::test]
    async fn test_create_without_blob_sha_stores_null() {
        let pool = setup_test_db().await;
        let comment = create_comment(&pool, 1, "src/main.rs", "no sha").await;
        assert!(comment.original_blob_sha.is_none());

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 1);
        assert!(comments[0].original_blob_sha.is_none());
    }

    #[tokio::test]
    async fn test_delete_pending() {
        let pool = setup_test_db().await;
        create_comment(&pool, 1, "a.rs", "pending1").await;
        create_comment(&pool, 1, "b.rs", "pending2").await;
        // Manually insert a 'sent' comment
        sqlx::query(
            "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status) VALUES (1, 'c.rs', 5, 'LEFT', 'sent comment', 'sent')"
        ).execute(&pool).await.unwrap();

        let affected = delete_pending(&pool, 1).await.unwrap();
        assert_eq!(affected, 2);

        let comments = list_by_feature(&pool, 1).await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].content, "sent comment");
        assert_eq!(comments[0].status, "sent");
    }

    // ---- Diff Viewed Files tests ----

    #[tokio::test]
    async fn test_mark_and_list_viewed() {
        let pool = setup_test_db().await;
        mark_viewed(&pool, 1, "src/main.rs", "abc123")
            .await
            .unwrap();
        mark_viewed(&pool, 1, "src/lib.rs", "def456").await.unwrap();

        let viewed = list_viewed_by_feature(&pool, 1).await.unwrap();
        assert_eq!(viewed.len(), 2);
        let paths: Vec<&str> = viewed.iter().map(|v| v.file_path.as_str()).collect();
        assert!(paths.contains(&"src/main.rs"));
        assert!(paths.contains(&"src/lib.rs"));
    }

    #[tokio::test]
    async fn test_mark_viewed_upsert() {
        let pool = setup_test_db().await;
        mark_viewed(&pool, 1, "src/main.rs", "sha_old")
            .await
            .unwrap();
        mark_viewed(&pool, 1, "src/main.rs", "sha_new")
            .await
            .unwrap();

        let viewed = list_viewed_by_feature(&pool, 1).await.unwrap();
        assert_eq!(viewed.len(), 1);
        assert_eq!(viewed[0].blob_sha, "sha_new");
    }

    #[tokio::test]
    async fn test_unmark_viewed() {
        let pool = setup_test_db().await;
        mark_viewed(&pool, 1, "src/main.rs", "abc123")
            .await
            .unwrap();
        unmark_viewed(&pool, 1, "src/main.rs").await.unwrap();

        let viewed = list_viewed_by_feature(&pool, 1).await.unwrap();
        assert!(viewed.is_empty());
    }

    #[tokio::test]
    async fn test_clear_all_viewed() {
        let pool = setup_test_db().await;
        mark_viewed(&pool, 1, "a.rs", "sha1").await.unwrap();
        mark_viewed(&pool, 1, "b.rs", "sha2").await.unwrap();
        mark_viewed(&pool, 1, "c.rs", "sha3").await.unwrap();

        let affected = clear_all_viewed(&pool, 1).await.unwrap();
        assert_eq!(affected, 3);

        let viewed = list_viewed_by_feature(&pool, 1).await.unwrap();
        assert!(viewed.is_empty());
    }
}
