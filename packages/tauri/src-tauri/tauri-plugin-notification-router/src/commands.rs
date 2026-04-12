#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSDictionary, NSString};
#[cfg(target_os = "macos")]
use objc2_user_notifications::{
    UNMutableNotificationContent, UNNotificationRequest, UNUserNotificationCenter,
};

use crate::NOTIFICATIONS_AVAILABLE;
use crate::PERMISSION_GRANTED;

#[tauri::command]
pub fn send_notification(
    title: String,
    body: String,
    feature_id: i64,
    project_id: i64,
    route_type: String,
) -> Result<(), String> {
    if !NOTIFICATIONS_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    unsafe {
        let center = UNUserNotificationCenter::currentNotificationCenter();

        let content: Retained<UNMutableNotificationContent> =
            msg_send![UNMutableNotificationContent::alloc(), init];

        let ns_title = NSString::from_str(&title);
        let ns_body = NSString::from_str(&body);
        content.setTitle(&ns_title);
        content.setBody(&ns_body);

        let category_id = NSString::from_str("AGENT_COMPLETE");
        content.setCategoryIdentifier(&category_id);

        build_and_set_user_info(&content, feature_id, project_id, &route_type);

        let request_id = NSString::from_str(&format!(
            "cadence-{}-{}-{}",
            feature_id,
            project_id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));

        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &request_id,
            &content,
            None,
        );

        center.addNotificationRequest_withCompletionHandler(&request, None);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn build_and_set_user_info(
    content: &UNMutableNotificationContent,
    feature_id: i64,
    project_id: i64,
    route_type: &str,
) {
    let keys: Vec<Retained<NSString>> = vec![
        NSString::from_str("feature_id"),
        NSString::from_str("project_id"),
        NSString::from_str("route_type"),
    ];
    let vals: Vec<Retained<NSString>> = vec![
        NSString::from_str(&feature_id.to_string()),
        NSString::from_str(&project_id.to_string()),
        NSString::from_str(route_type),
    ];

    let key_refs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let val_refs: Vec<&NSString> = vals.iter().map(|v| &**v).collect();

    let user_info: Retained<NSDictionary<NSString, NSString>> =
        NSDictionary::from_slices(&key_refs, &val_refs);
    let user_info_any: &NSDictionary<AnyObject, AnyObject> = &*(&*user_info
        as *const NSDictionary<NSString, NSString>
        as *const NSDictionary<AnyObject, AnyObject>);
    content.setUserInfo(user_info_any);
}

/// Waits for the authorization result (up to 3s) and returns it.
/// Returns false immediately if notifications aren't available.
#[tauri::command]
pub fn check_permission() -> Result<bool, String> {
    if !NOTIFICATIONS_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(false);
    }
    // Authorization callback fires async on the ObjC side — poll the OnceLock briefly.
    for _ in 0..30 {
        if let Some(&granted) = PERMISSION_GRANTED.get() {
            return Ok(granted);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(false)
}
